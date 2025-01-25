// js/app.js

// Chakra UI (window.chakra) から必要なコンポーネントを取得
const {
  ChakraProvider,
  Box,
  Heading,
  Text,
  Input,
  Button,
  HStack,
  VStack
} = window.chakra;

// React用のフック
const { useState, useRef } = React;

/**
 * メインのReactコンポーネント
 */
function App() {
  // --------------------------------------
  // StateやRefの準備
  // --------------------------------------
  const [statusMsg, setStatusMsg] = useState("");

  // デバイス接続状態
  const [isConnected, setIsConnected] = useState(false);
  const [characteristic, setCharacteristic] = useState(null);

  // ベースライン計測の設定
  const [measureMinutes, setMeasureMinutes] = useState(5); // 計測時間(分)
  const [isMeasuringBaseline, setIsMeasuringBaseline] = useState(false);
  const [baselineFinished, setBaselineFinished] = useState(false);
  const baselineTimerRef = useRef(null);

  // ベースライン計測結果
  const [baselineSDNN, setBaselineSDNN] = useState("--");
  const [baselineRMSSD, setBaselineRMSSD] = useState("--");

  // リアルタイム表示
  const [currentHR, setCurrentHR] = useState("--");
  const [currentSDNN, setCurrentSDNN] = useState("--");
  const [currentRMSSD, setCurrentRMSSD] = useState("--");

  // RR間隔を格納する配列 (ベースライン中 / ベースライン後)
  const baselineRRs = useRef([]);
  const afterBaselineRRs = useRef([]);

  // --------------------------------------
  // Polar接続
  // --------------------------------------
  async function handleConnect() {
    try {
      setStatusMsg("デバイスをスキャンしています...");
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ["heart_rate"] }]
      });
      setStatusMsg("接続中...");

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService("heart_rate");
      const char = await service.getCharacteristic("heart_rate_measurement");

      // Notificationsを有効にして、イベントを受け取る
      await char.startNotifications();
      char.addEventListener("characteristicvaluechanged", handleCharacteristicValueChanged);

      setCharacteristic(char);
      setIsConnected(true);
      setStatusMsg("デバイスと接続しました。ベースライン計測を開始できます。");
    } catch (err) {
      console.error(err);
      setStatusMsg("接続エラー: " + err);
    }
  }

  // --------------------------------------
  // ベースライン計測開始
  // --------------------------------------
  function handleStartBaseline() {
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
    setBaselineSDNN("--");
    setBaselineRMSSD("--");
    setBaselineFinished(false);

    setIsMeasuringBaseline(true);
    setStatusMsg(`ベースライン計測中...（${measureMinutes}分）`);

    // タイマーを設定
    if (baselineTimerRef.current) {
      clearTimeout(baselineTimerRef.current);
    }
    baselineTimerRef.current = setTimeout(() => {
      finishBaseline();
    }, measureMinutes * 60 * 1000);
  }

  // --------------------------------------
  // ベースライン計測終了
  // --------------------------------------
  function finishBaseline() {
    setIsMeasuringBaseline(false);
    setBaselineFinished(true);
    setStatusMsg("ベースライン計測が終了しました。結果を計算します...");

    // ベースラインのRR配列からSDNN/RMSSDを計算
    const { sdnn, rmssd } = calcTimeDomainMetrics(baselineRRs.current);
    setBaselineSDNN(sdnn.toFixed(2));
    setBaselineRMSSD(rmssd.toFixed(2));

    setStatusMsg(
      "ベースライン計測完了。以後もリアルタイムでSDNN/RMSSDを更新します。"
    );
  }

  // --------------------------------------
  // Heart Rate Measurement の通知受信時
  // --------------------------------------
  function handleCharacteristicValueChanged(event) {
    const value = event.target.value;
    const flags = value.getUint8(0);
    let index = 1;

    // 心拍数（8 or 16bit）
    const is16Bits = flags & 0x01;
    let heartRate = 0;
    if (is16Bits) {
      heartRate = value.getUint16(index, true);
      index += 2;
    } else {
      heartRate = value.getUint8(index);
      index += 1;
    }
    setCurrentHR(heartRate);

    // RR間隔フラグ (bit4)
    const rrIncluded = flags & 0x10;
    if (rrIncluded) {
      while (index + 1 < value.byteLength) {
        const rrValue = value.getUint16(index, true);
        index += 2;
        // 1/1024秒単位 → ミリ秒
        const rrMs = rrValue * (1000 / 1024);

        if (isMeasuringBaseline) {
          baselineRRs.current.push(rrMs);
        } else {
          afterBaselineRRs.current.push(rrMs);
        }
      }
    }

    // ベースライン終了後ならリアルタイムでSDNN/RMSSDを計算
    if (baselineFinished) {
      updateRealTimeMetrics();
    }
  }

  // --------------------------------------
  // リアルタイムでSDNN/RMSSDを計算・更新
  // --------------------------------------
  function updateRealTimeMetrics() {
    const arr = afterBaselineRRs.current;
    if (arr.length < 2) {
      setCurrentSDNN("--");
      setCurrentRMSSD("--");
      return;
    }
    const { sdnn, rmssd } = calcTimeDomainMetrics(arr);
    setCurrentSDNN(sdnn.toFixed(2));
    setCurrentRMSSD(rmssd.toFixed(2));
  }

  // --------------------------------------
  // SDNN, RMSSDを計算するユーティリティ
  // --------------------------------------
  function calcTimeDomainMetrics(rrArray) {
    if (rrArray.length < 2) {
      return { sdnn: 0, rmssd: 0 };
    }
    // 平均
    const meanRR = rrArray.reduce((a, b) => a + b, 0) / rrArray.length;

    // 分散 → SDNN
    const variance =
      rrArray.reduce((acc, val) => acc + (val - meanRR) ** 2, 0) / rrArray.length;
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

  // --------------------------------------
  // UIを描画（Chakra UIのコンポーネントを使用）
  // --------------------------------------
  return (
    <Box p={4}>
      <Heading mb={4}>Polar Verity Sense HRV Demo</Heading>

      {/* デバイス接続ボタン */}
      <Button 
        colorScheme="blue" 
        onClick={handleConnect} 
        isDisabled={isConnected}
        mb={4}
      >
        1. デバイスと接続
      </Button>

      {/* ベースライン計測設定 */}
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

      {/* ベースライン計測結果 */}
      {baselineFinished && (
        <Box p={4} borderWidth="1px" borderRadius="md" mb={8}>
          <Heading size="md" mb={2}>ベースライン計測結果</Heading>
          <Text>SDNN: {baselineSDNN} ms</Text>
          <Text>RMSSD: {baselineRMSSD} ms</Text>
        </Box>
      )}

      {/* リアルタイム表示 */}
      <Box p={4} borderWidth="1px" borderRadius="md">
        <Heading size="md" mb={2}>リアルタイム表示</Heading>
        <VStack align="start">
          <Text>Heart Rate: {currentHR} bpm</Text>
          <Text>SDNN: {currentSDNN} ms</Text>
          <Text>RMSSD: {currentRMSSD} ms</Text>
        </VStack>
      </Box>
    </Box>
  );
}

// ルートをレンダリング
function Main() {
  return (
    <window.chakra.ChakraProvider>
      <App />
    </window.chakra.ChakraProvider>
  );
}

// React 18+ の新しいレンダリングAPI
const rootElement = document.getElementById("root");
ReactDOM.createRoot(rootElement).render(<Main />);
