document.addEventListener("DOMContentLoaded", function() {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const fileListDiv = document.getElementById("fileList");
  const mergeCsvBtn = document.getElementById("mergeCsvBtn");
  const mergeXlsxBtn = document.getElementById("mergeXlsxBtn");
  const messageDiv = document.getElementById("message");

  // 解析後のデータを保持
  let hrvDataArray = [];         // [{ dateTimeStr, bpm, sdnn, rmssd }, ...]
  let affectiveDataArray = [];   // [{ dateTimeStr, arousal, pleasure }, ...]

  // ドラッグ＆ドロップ
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
    // ファイル情報を表示
    fileListDiv.innerHTML += `<div class="file-info"><strong>${fileName}</strong> を読み込みました。</div>`;

    // 名前からファイル種別を判定（例: "-HRV" or "_HRV" で心拍）
    if (fileName.includes("-HRV") || fileName.includes("_HRV")) {
      loadHRVData(data);
    } else if (fileName.includes("AffectiveSlider")) {
      loadAffectiveData(data);
    } else {
      // 必要に応じて BaselineResults, etc. を追加
      fileListDiv.innerHTML += `<div>このファイルはHRVにもAffectiveにも該当しません。</div>`;
    }

    // HRVとAffectiveの両方が揃ったら、ダウンロードボタンを有効に
    if (hrvDataArray.length > 0 && affectiveDataArray.length > 0) {
      mergeCsvBtn.disabled = false;
      mergeXlsxBtn.disabled = false;
    }
  }

  // === HRVデータを読み込む ===
  function loadHRVData(data) {
    // data: [{DateTime, BPM, SDNN (ms), RMSSD (ms), ...}, ...]
    // 既存データをクリアして再読み込みする場合は、hrvDataArray = [] するなど
    data.forEach(row => {
      const dateTimeStr = row.DateTime;  // ex) "2025/02/10 10:30:44"
      const bpm    = parseFloat(row.BPM) || 0;
      const sdnn   = parseFloat(row["SDNN (ms)"]) || 0;
      const rmssd  = parseFloat(row["RMSSD (ms)"]) || 0;

      hrvDataArray.push({ dateTimeStr, bpm, sdnn, rmssd });
    });
    // 時刻でソートしておくと後のマージがやりやすい
    hrvDataArray.sort((a, b) => parseDate(a.dateTimeStr) - parseDate(b.dateTimeStr));
  }

  // === Affectiveデータを読み込む ===
  function loadAffectiveData(data) {
    // data: [{Time:'10:35:20', arousal:'34', pleasure:'46'}, ...]
    data.forEach(row => {
      const timeStr   = row.Time; // ex) "10:35:20" or "2025/02/10 10:35:20"
      const arousal   = parseFloat(row.arousal) || 0;
      const pleasure  = parseFloat(row.pleasure) || 0;

      // Time列の扱いが「日付+時刻」か「時刻のみ」かで変わるため、
      // 必要に応じて補完する等の処理を書くことも
      affectiveDataArray.push({
        dateTimeStr: timeStr,
        arousal,
        pleasure
      });
    });
    affectiveDataArray.sort((a, b) => parseDate(a.dateTimeStr) - parseDate(b.dateTimeStr));
  }

  // === 「CSVダウンロード」ボタン ===
  mergeCsvBtn.addEventListener("click", function() {
    const merged = mergeData(hrvDataArray, affectiveDataArray);

    // CSVへ変換（Papa.unparse）
    const csvString = Papa.unparse(merged);
    downloadFile(csvString, "MergedData.csv", "text/csv");
  });

  // === 「Excelダウンロード」ボタン ===
  mergeXlsxBtn.addEventListener("click", function() {
    const merged = mergeData(hrvDataArray, affectiveDataArray);

    // SheetJSでワークシートを作成
    const worksheet = XLSX.utils.json_to_sheet(merged);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Merged");

    // Excelファイルとして書き出し
    const wbout = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    downloadFile(blob, "MergedData.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  // === マージのロジック ===
  function mergeData(hrvArr, affArr) {
    // ここでは「時刻が同じ or 近い行」を結びつける簡易実装。
    // 例えば ±1秒以内など、厳密なルールを決めてもOK
    // 今回は「最も近い時刻」を探して結合

    let merged = [];
    hrvArr.forEach(hrvItem => {
      const tHrv = parseDate(hrvItem.dateTimeStr);

      // affectiveDataの中から、時刻が最も近い要素を見つける
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

      // bestMatch が見つかったら、1行にまとめる
      // ただし、diff が大きすぎたら結合しない等の条件もあり得る
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
        // Affective が存在しない場合でも、とりあえず HRV のみの行を出力したい場合
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

  // === ダウンロード用の汎用関数 ===
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

  // === 時刻文字列をDateオブジェクトに変換 ===
  // 例: "2025/02/10 10:30:44" or "10:30:44" or "2025-02-10T10:30:44"
  function parseDate(str) {
    // 簡易実装: 日付が含まれない場合は固定の日付を付与 (2025/02/10)
    if (!str.match(/\d{4}.\d{2}.\d{2}/)) {
      // 日付を含んでいない ("HH:MM:SS" のみ)
      str = "2025/02/10 " + str;
    }
    // Dateコンストラクタに渡してパース
    return new Date(str);
  }
});
