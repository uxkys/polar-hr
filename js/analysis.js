document.addEventListener("DOMContentLoaded", function() {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const resultsDiv = document.getElementById("results");

  // グラフ描画用のコンテキスト
  let hrvChart, affectiveChart;
  let hrvChartData = null;  // HRVチャートの元データを保持
  let hrDataArray = [];     // 生のHRVデータ（DateTime, BPM, SDNN(ms), RMSSD(ms)等）をすべて保持
  
  const intervalPanel = document.getElementById("intervalPanel");
  const compareBtn = document.getElementById("compareBtn");
  const analysisResultDiv = document.getElementById("analysisResult");

  // ドラッグ＆ドロップイベント
  dropzone.addEventListener("dragover", e => {
    e.preventDefault();
    dropzone.style.backgroundColor = "#eef";
  });
  dropzone.addEventListener("dragleave", e => {
    e.preventDefault();
    dropzone.style.backgroundColor = "";
  });
  dropzone.addEventListener("drop", e => {
    e.preventDefault();
    dropzone.style.backgroundColor = "";
    handleFiles(e.dataTransfer.files);
  });

  // ファイル選択ボタン
  fileInput.addEventListener("change", e => {
    handleFiles(e.target.files);
  });

  // ファイル処理
  function handleFiles(files) {
    Array.from(files).forEach(file => {
      parseCSV(file);
    });
  }

  // CSV解析 (Papa Parse)
  function parseCSV(file) {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: function(results) {
        analyzeFile(file.name, results.data);
      }
    });
  }

  function analyzeFile(fileName, data) {
    resultsDiv.innerHTML += `<h3>${fileName}</h3>`;

    // 名前からファイル種別を判別
    if (fileName.includes("_HRV")) {
      analyzeHRVData(data);
    } else if (fileName.includes("BaselineResults")) {
      analyzeBaseline(data);
    } else if (fileName.includes("AffectiveSlider")) {
      analyzeAffective(data);
    } else {
      resultsDiv.innerHTML += "<p>このファイルの種類は不明です。</p>";
    }
  }

  // === HRVデータ解析・表示 ===
  function analyzeHRVData(data) {
    // data: [{DateTime, Elapsed, BPM, SDNN (ms), RMSSD (ms), ...}, ...]
    // 数値にパースして配列に格納
    let labels = [];
    let bpmVals = [];
    let sdnnVals = [];
    let rmssdVals = [];

    data.forEach(row => {
      // DateTimeをそのまま文字列として扱う（後で区間指定用にパースする）
      const dateTimeStr = row.DateTime;
      const bpm = parseFloat(row.BPM) || 0;
      const sdnn = parseFloat(row["SDNN (ms)"]) || 0;
      const rmssd = parseFloat(row["RMSSD (ms)"]) || 0;

      labels.push(dateTimeStr);
      bpmVals.push(bpm);
      sdnnVals.push(sdnn);
      rmssdVals.push(rmssd);

      // 区間比較用に保存
      hrDataArray.push({
        dateTimeStr,
        bpm,
        sdnn,
        rmssd
      });
    });

    // グラフ作成（Chart.js）
    const ctx = document.getElementById("hrvChart").getContext("2d");
    if (hrvChart) {
      hrvChart.destroy();
    }
    hrvChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'BPM',
            data: bpmVals,
            borderColor: 'blue',
            fill: false,
            yAxisID: 'y1'
          },
          {
            label: 'SDNN (ms)',
            data: sdnnVals,
            borderColor: 'red',
            fill: false,
            yAxisID: 'y2'
          },
          {
            label: 'RMSSD (ms)',
            data: rmssdVals,
            borderColor: 'green',
            fill: false,
            yAxisID: 'y2'
          }
        ]
      },
      options: {
        responsive: true,
        scales: {
          x: {
            display: true
          },
          y1: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'BPM' },
            beginAtZero: true
          },
          y2: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'HRV(ms)' },
            beginAtZero: true,
            grid: { drawOnChartArea: false }
          }
        }
      }
    });

    // 区間指定パネルを表示
    intervalPanel.style.display = "block";
  }

  // === ベースライン解析・表示 ===
  function analyzeBaseline(data) {
    // data: [{Parameter:'BPM', Value:'72.00'}, {Parameter:'SDNN (ms)',Value:'50.75'}, ...]
    resultsDiv.innerHTML += "<ul>";
    data.forEach(row => {
      resultsDiv.innerHTML += `<li>${row.Parameter}: ${row.Value}</li>`;
    });
    resultsDiv.innerHTML += "</ul>";
  }

  // === アフェクティブスライダー解析・表示 ===
  function analyzeAffective(data) {
    // data: [{Time:'10:35:20', arousal:'34', pleasure:'46'}, ...]
    let timeLabels = [];
    let arousalValues = [];
    let pleasureValues = [];

    data.forEach(row => {
      timeLabels.push(row.Time);
      arousalValues.push(parseFloat(row.arousal));
      pleasureValues.push(parseFloat(row.pleasure));
    });

    const ctx2 = document.getElementById("affectiveChart").getContext("2d");
    if (affectiveChart) {
      affectiveChart.destroy();
    }
    affectiveChart = new Chart(ctx2, {
      type: 'line',
      data: {
        labels: timeLabels,
        datasets: [
          {
            label: 'Arousal',
            data: arousalValues,
            borderColor: 'orange',
            fill: false
          },
          {
            label: 'Pleasure',
            data: pleasureValues,
            borderColor: 'purple',
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });
  }

  // === 区間比較：有意差検定 ===
  compareBtn.addEventListener("click", function() {
    analysisResultDiv.innerHTML = ""; // クリア

    // 入力された開始・終了時刻を取得
    const startTime1 = document.getElementById("startTime1").value.trim();
    const endTime1   = document.getElementById("endTime1").value.trim();
    const startTime2 = document.getElementById("startTime2").value.trim();
    const endTime2   = document.getElementById("endTime2").value.trim();

    if (!startTime1 || !endTime1 || !startTime2 || !endTime2) {
      alert("4つの時刻をすべて入力してください。");
      return;
    }

    // それぞれの区間のデータを抽出
    let interval1 = filterDataByTimeRange(hrDataArray, startTime1, endTime1);
    let interval2 = filterDataByTimeRange(hrDataArray, startTime2, endTime2);

    if (interval1.length < 2 || interval2.length < 2) {
      analysisResultDiv.innerHTML = "<p>十分なデータがありません。</p>";
      return;
    }

    // SDNN, RMSSD の配列を作る
    const sdnn1 = interval1.map(d => d.sdnn);
    const sdnn2 = interval2.map(d => d.sdnn);
    const rmssd1 = interval1.map(d => d.rmssd);
    const rmssd2 = interval2.map(d => d.rmssd);

    // simple-statistics を使って tTestTwoSample
    // 帰無仮説: 両グループの平均に有意差がない
    // alternative: "two-sided" (両側検定)
    const sdnnPvalue = ss.tTestTwoSample(sdnn1, sdnn2, {varianceEquality: 'unequal'});
    const rmssdPvalue = ss.tTestTwoSample(rmssd1, rmssd2, {varianceEquality: 'unequal'});

    // 結果表示
    let resultHtml = `
      <h4>SDNNの比較</h4>
      <p>Interval1 (n=${sdnn1.length}), Interval2 (n=${sdnn2.length})</p>
      <p>p-value = ${sdnnPvalue.toFixed(5)}</p>

      <h4>RMSSDの比較</h4>
      <p>Interval1 (n=${rmssd1.length}), Interval2 (n=${rmssd2.length})</p>
      <p>p-value = ${rmssdPvalue.toFixed(5)}</p>
    `;
    analysisResultDiv.innerHTML = resultHtml;
  });

  // === 時刻指定に応じてデータを絞り込む ===
  function filterDataByTimeRange(dataArray, start, end) {
    // 時刻文字列 (例 "2025/02/10 10:30:48" や "10:30:48") を
    // Dateオブジェクトへ変換するためのヘルパー
    // 入力が "HH:MM:SS" のみの場合は、日にちを固定
    function parseTimeString(tstr) {
      // "YYYY/MM/DD HH:MM:SS" or "HH:MM:SS" 想定
      if (tstr.includes("/")) {
        // フル日付
        return new Date(tstr);
      } else {
        // 今日の日付に付加する想定 (実験日を固定するなら固定文字列を先頭につける等)
        // ここでは便宜上 2025/02/10 を付ける例
        return new Date("2025/02/10 " + tstr);
      }
    }

    const startDate = parseTimeString(start);
    const endDate   = parseTimeString(end);

    // startDate <= date <= endDate の範囲でフィルタ
    return dataArray.filter(d => {
      const currentDate = parseTimeString(d.dateTimeStr);
      return currentDate >= startDate && currentDate <= endDate;
    });
  }
});
