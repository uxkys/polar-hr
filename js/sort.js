document.addEventListener("DOMContentLoaded", function() {
  // HTML要素の取得
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const fileListDiv = document.getElementById("fileList");
  const mergeCsvBtn = document.getElementById("mergeCsvBtn");
  const mergeXlsxBtn = document.getElementById("mergeXlsxBtn");
  const messageDiv = document.getElementById("message");
  const loader = document.getElementById("loader");

  // ファイル読み込み状態を管理するフラグ
  let isLoading = false;

  // HRV/Affective の読み込み確認用
  let hrvLoaded = false;
  let affectiveLoaded = false;

  // 解析後のデータを保持
  let hrvDataArray = [];         // [{ dateTimeStr, bpm, sdnn, rmssd }, ...]
  let affectiveDataArray = [];   // [{ dateTimeStr, arousal, pleasure }, ...]

  // ========== イベント設定 ==========

  // ドラッグ&ドロップ
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

  // ファイル選択
  fileInput.addEventListener("change", e => {
    handleFiles(e.target.files);
  });

  // CSVダウンロードボタン
  mergeCsvBtn.addEventListener("click", function() {
    const merged = mergeData(hrvDataArray, affectiveDataArray);
    const csvString = Papa.unparse(merged);
    downloadFile(csvString, "MergedData.csv", "text/csv");
  });

  // Excelダウンロードボタン
  mergeXlsxBtn.addEventListener("click", function() {
    const merged = mergeData(hrvDataArray, affectiveDataArray);
    // SheetJSでワークシートを作成
    const worksheet = XLSX.utils.json_to_sheet(merged);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Merged");

    // Excelファイルとして書き出し
    const wbout = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    downloadFile(blob, "MergedData.xlsx", 
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  // ========== ファイル処理ロジック ==========

  function handleFiles(files) {
    // まとめて読み込む際に、ローディングを開始
    if (!isLoading) {
      isLoading = true;
      showLoader(true); // スピナー表示
    }

    // ファイルごとに解析
    let fileCount = files.length;
    let processedCount = 0;

    Array.from(files).forEach(file => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          analyzeFile(file.name, results.data);
          processedCount++;

          // 全ファイル処理が完了したらローディング終了
          if (processedCount >= fileCount) {
            isLoading = false;
            showLoader(false); // スピナー非表示
            // ボタンの有効/無効を更新
            updateButtonStatus();
          }
        }
      });
    });
  }

  function analyzeFile(fileName, data) {
    // ファイル情報を表示
    fileListDiv.innerHTML += `<div class="file-info"><strong>${fileName}</strong> を読み込みました。</div>`;

    // 名前からファイル種別を判定
    if (fileName.includes("-HRV") || fileName.includes("_HRV")) {
      loadHRVData(data);
      hrvLoaded = true;
    } else if (fileName.includes("AffectiveSlider")) {
      loadAffectiveData(data);
      affectiveLoaded = true;
    } else {
      fileListDiv.innerHTML += 
        `<div>このファイルはHRVにもAffectiveにも該当しません。</div>`;
    }
  }

  // HRVデータを読み込む
  function loadHRVData(data) {
    data.forEach(row => {
      const dateTimeStr = row.DateTime;  // ex "2025/02/10 10:30:44"
      const bpm   = parseFloat(row.BPM) || 0;
      const sdnn  = parseFloat(row["SDNN (ms)"]) || 0;
      const rmssd = parseFloat(row["RMSSD (ms)"]) || 0;

      hrvDataArray.push({ dateTimeStr, bpm, sdnn, rmssd });
    });
    // 時刻でソート
    hrvDataArray.sort((a, b) => parseDate(a.dateTimeStr) - parseDate(b.dateTimeStr));
  }

  // Affectiveデータを読み込む
  function loadAffectiveData(data) {
    data.forEach(row => {
      const timeStr  = row.Time; // ex "10:35:20" or "2025/02/10 10:35:20"
      const arousal  = parseFloat(row.arousal) || 0;
      const pleasure = parseFloat(row.pleasure) || 0;
      affectiveDataArray.push({ dateTimeStr: timeStr, arousal, pleasure });
    });
    affectiveDataArray.sort((a, b) => parseDate(a.dateTimeStr) - parseDate(b.dateTimeStr));
  }

  // ボタンの有効/無効を更新
  function updateButtonStatus() {
    // HRVとAffectiveが最低1つずつ読み込まれていれば有効化
    if (hrvLoaded && affectiveLoaded) {
      mergeCsvBtn.disabled = false;
      mergeXlsxBtn.disabled = false;
    }
  }

  // ローダー表示制御
  function showLoader(isShow) {
    loader.style.display = isShow ? "block" : "none";
  }

  // マージ処理
  function mergeData(hrvArr, affArr) {
    let merged = [];
    hrvArr.forEach(hrvItem => {
      const tHrv = parseDate(hrvItem.dateTimeStr);

      // affectiveDataの中から、最も近い時刻を探す
      let bestMatch = null;
      let minDiff = Infinity;
      affArr.forEach(affItem => {
        const tAff = parseDate(affItem.dateTimeStr);
        const diff = Math.abs(tHrv - tAff);
        if (diff < minDiff) {
          minDiff = diff;
          bestMatch = affItem;
        }
      });

      if (bestMatch) {
        merged.push({
          dateTime: hrvItem.dateTimeStr,
          bpm: hrvItem.bpm,
          sdnn: hrvItem.sdnn,
          rmssd: hrvItem.rmssd,
          arousal: bestMatch.arousal,
          pleasure: bestMatch.pleasure
        });
      } else {
        // Affective側がマッチしない場合
        merged.push({
          dateTime: hrvItem.dateTimeStr,
          bpm: hrvItem.bpm,
          sdnn: hrvItem.sdnn,
          rmssd: hrvItem.rmssd,
          arousal: "",
          pleasure: ""
        });
      }
    });
    return merged;
  }

  // ダウンロード用関数
  function downloadFile(content, fileName, contentType) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(
      content instanceof Blob
        ? content
        : new Blob([content], { type: contentType })
    );
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  // 時刻文字列をDateに変換 (簡易実装)
  function parseDate(str) {
    if (!str.match(/\d{4}.\d{2}.\d{2}/)) {
      // 日付がなければデフォルト日付を付与
      str = "2025/02/10 " + str;
    }
    return new Date(str);
  }
});
