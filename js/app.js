// app.js

// React/ChakraUIのimport（グローバルスクリプト読み込みの場合、window.chakra として参照できます）
const { 
  ChakraProvider, 
  Box, 
  Button, 
  Heading, 
  Text, 
  Input, 
  HStack, 
  VStack 
} = window.chakra;
const { useState, useEffect, useRef } = React; // React 18

function App() {
  // ==== State 管理 ====
  const [device, setDevice] = useState(null);
  const [characteristic, setCharacteristic] = useState(null);

  const [statusMsg, setStatusMsg] = useState("");
  const [isConnected, setIsConnected] = useState(false);

  // ベースライン関連
  const [measureMinutes, setMeasureMinutes] = useState(5);  // 計測する分数(初期値5)
  const [isMeasuringBaseline, setIsMeasuringBaseline] = useState(false);
  const [baselineFinished, setBaselineFinished] = useState(false);
  const baselineTimerRef = useRef(null);

  // ベースライン計測結果
  const [baselineSDNN, setBaselineSDNN] = useState(null);
  const [baselineRMSSD, setBaselineRMSSD] = useState(null);

  // リアルタイム表示用
  const [currentHR, setCurrentHR] = useState("--"); // 最新の心拍数
  const [currentSDNN, setCurrentSDNN] = useState("--");
  const [currentRMSSD, setCurrentRMSSD] = useState("--");

  // RR間隔を保持するための配列
  // baseline中は baselineRRs に格納, baseline終了後は afterBaselineRRs に格納
  const baselineRRs = useRef([]);     
  const afterBaselineRRs = useRef([]); 

  // ==== Polarデバイスに接続 ====
  const handleConnect = async () => {
    try {
      setStatusMsg("デバイスをスキャンしています...");
      const dev = await navigator.bluetooth.requestDevice({
        filters: [{ services: ["heart_rate"] }]
      });
      setDevice(dev);
      setStatusMsg("接続中...");
      const server = await dev.gatt.connect();
      const service = await server.getPrimaryService("heart_rate");
      const char = await service.getCharacteristic("heart_rate_measurement");
      await char.startNotifications();
      char.addEventListener("characteristicvaluechanged", handleCharacteristicValueChanged);

      setCharacteristic(char);
      setIsConnected(true);
      setStatusMsg("デバイスと接続しました。ベースライン計測を開始できます。");
    } catch (error) {
      console.error(error);
      setStatusMsg("接続エラー: " + error);
    }
  };

  // ==== ベースライン計測開始 ====
  const handleStartBaseline = () => {
    if (!characteristic) {
      alert("先にデバイスと接続してください。");
      return;
    }
    if (measureMinutes < 1) {
      alert("ベースライン計測時間は1以上を指定してください。");
      return;
    }
    // 状態リセット
    baselineRRs.current = [];
    afterBaselineRRs.current = [];
    setBaselineSDNN(null);
    setBaselineRMSSD(null);
    setBaselineFinished(false);

    setIsMeasuringBaseline(true);
    setStatusMsg(`ベースライン計測中...（${measureMinutes}分）`);

    // タイマーをセット
    if (baselineTimerRef.current) {
      clearTimeout(baselineTimerRef.current);
    }
    baselineTimerRef.current = setTimeout(() => {
      finishBaseline();
    }, measureMinutes * 60 * 1000);
  };

  // ==== ベースライン計測終了処理 ====
  const finishBaseline = () => {
    setIsMeasuringBaseline(false);
    setBaselineFinished(true);
    setStatusMsg("ベースライン計測が終了しました。結果を計算します...");

    // RR配列から計算
    const { sdnn, rmssd } = calcTimeDomainMetrics(baselineRRs.current);
    setBaselineSDNN(sdnn.toFixed(2));
    setBaselineRMSSD(rmssd.toFixed(2));

    setStatusMsg("ベースライン計測完了。以後もリアルタイムでSDNN/RMSSDを計算します。");
  };

  // ==== Characteristic値変更(新たな心拍)が届いたとき ====
  const handleCharacteristicValueChanged = (event) => {
    const value = event.target.value;
    const flags = value.getUint8(0);
    let index = 1;

    // 心拍数が8bit or 16bitか
    const is16Bits = flags & 0x01;
    let heartRate;
    if (is16Bits) {
      heartRate = value.getUint16(index, true);
      index += 2;
    } else {
      heartRate = value.getUint8(index);
      index += 1;
    }
    setCurrentHR(heartRate);

    // RR間隔が含まれているか (bit4)
    const rrIncluded = flags & 0x10;
    if (rrIncluded) {
      while (index + 1 < value.byteLength) {
        const rrValue = value.getUint16(index, true);
        index += 2;
        // RRは1/1024秒単位 → ミリ秒へ近似変換
        const rrMs = rrValue * (1000 / 1024);

        if (isMeasuringBaseline) {
          baselineRRs.current.push(rrMs);
        } else {
          // ベースライン終了後は こちらに格納
          afterBaselineRRs.current.push(rrMs);
        }
      }
    }
    // 毎回リアルタイムでSDNN/RMSSDを計算・更新
    updateRealTimeHRV();
  };

  // ==== リアルタイムでSDNN/RMSSDを計算・表示 ====
  const updateRealTimeHRV = () => {
    // ベースライン中はまだリアルタイム表示しなくてもOKですが、
    // ベースライン計測中も見たい場合は、baselineRRs.currentで計算するのもアリ
    let targetRRs = afterBaselineRRs.current;

    // ベースラインが終わっていなければ計算しない
    if (!baselineFinished) {
      // 「まだベースライン中なのでリアルタイムは--のままにする」か、
      // 「baselineRRsで計算する」かは好みで調整してください。
      return;
    }

    if (targetRRs.length < 2) {
      setCurrentSDNN("--");
      setCurrentRMSSD("--");
      return;
    }

    const { sdnn, rmssd } = calcTimeDomainMetrics(targetRRs);
    setCurrentSDNN(sdnn.toFixed(2));
    setCurrentRMSSD(rmssd.toFixed(2));
  };

  // ==== SDNN, RMSSDを計算するユーティリティ関数 ====
  function calcTimeDomainMetrics(rrArray) {
    if (rrArray.length < 2) {
      return { sdnn: 0, rmssd: 0 };
    }
    // 平均RR
    const meanRR = rrArray.reduce((a, b) => a + b, 0) / rrArray.length;
    // 分散 → SDNN
    const variance = rrArray.reduce((acc, val) => acc + Math.pow(val - meanRR, 2), 0) / rrArray.length;
    const sdnn = Math.sqrt(variance);

    // RMSSD
    let sumSqDiff = 0;
    for (let i = 1; i < rrArray.length; i++) {
      const diff = rrArray[i] - rrArray[i - 1];
      sumSqDiff += diff * diff;
    }
    const meanSqDiff = sumSqDiff / (rrArray.length - 1);
    const rmssd = Math.sqrt(meanSqDiff);

    return { sdnn, rmssd };
  }

  // ==== UI ====
  return (
    <Box p={4}>
      <Heading mb={4}>Polar Verity Sense HRV Demo</Heading>

      {/* 1) デバイス接続 */}
      <Button 
        colorScheme="blue" 
        onClick={handleConnect} 
        isDisabled={isConnected}
        mb={4}
      >
        1. デバイスと接続
      </Button>

      {/* 2) ベースライン計測 */}
      <HStack mb={4}>
        <Text>ベースライン計測時間(分):</Text>
        <Input 
          type="number"
          width="80px"
          value={measureMinutes}
          onChange={(e) => setMeasureMinutes(Number(e.target.value))}
        />
        <Button 
          colorScheme="green" 
          onClick={handleStartBaseline} 
          isDisabled={!isConnected}
        >
          ベースライン計測スタート
        </Button>
      </HStack>

      {/* ステータスメッセージ */}
      <Text mb={4}>{statusMsg}</Text>

      {/* ベースライン結果 */}
      {baselineFinished && (
        <Box mb={8} p={4} borderWidth="1px" borderRadius="md">
          <Heading size="md" mb={2}>ベースライン計測結果</Heading>
          <Text>SDNN: {baselineSDNN || "--"} ms</Text>
          <Text>RMSSD: {baselineRMSSD || "--"} ms</Text>
        </Box>
      )}

      {/* リアルタイム表示 */}
      <Box p={4} borderWidth="1px" borderRadius="md">
        <Heading size="md" mb={2}>リアルタイム計測</Heading>
        <VStack align="start">
          <Text>Heart Rate: {currentHR} bpm</Text>
          <Text>SDNN: {currentSDNN} ms</Text>
          <Text>RMSSD: {currentRMSSD} ms</Text>
        </VStack>
      </Box>
    </Box>
  );
}

// ルートにReactアプリをレンダリング
function Main() {
  return (
    <ChakraProvider>
      <App />
    </ChakraProvider>
  );
}

const rootElement = document.getElementById("root");
ReactDOM.createRoot(rootElement).render(<Main />);
