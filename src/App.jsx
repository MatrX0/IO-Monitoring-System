import { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";

const ESP32_IP = "192.168.1.7";
const API      = `http://${ESP32_IP}`;
const NUM_LEDS = 8;

export default function App() {
  // Bağlantı
  const [connected, setConnected]   = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  // LED ve switch durumu (ESP32'den geliyor)
  const [ledStates, setLedStates]   = useState(Array(NUM_LEDS).fill(false));
  const [swStates, setSwStates]     = useState(Array(NUM_LEDS).fill(false));
  const [activePattern, setActivePattern] = useState("00000000");
  const [allOn, setAllOn]           = useState(false);
  const [onCount, setOnCount]       = useState(0);

  // Kontroller
  const [ledColor, setLedColor]     = useState("#ffffff");
  const [brightness, setBrightness] = useState(128);

  // Pattern editörü
  const [bitInput, setBitInput]       = useState("00000000");
  const [bitSending, setBitSending]   = useState(false);
  const [bitFeedback, setBitFeedback] = useState(null);

  // Log
  const [uiLogs, setUiLogs]       = useState([]);
  const [serverLog, setServerLog] = useState("");
  const [logTab, setLogTab]       = useState("ui");

  const pollRef    = useRef(null);
  const logPollRef = useRef(null);

  const addLog = useCallback((msg) => {
    const t = new Date().toLocaleTimeString();
    setUiLogs((p) => [`[${t}] ${msg}`, ...p].slice(0, 80));
  }, []);

  // ── /status her saniye ────────────────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const res  = await fetch(`${API}/status`, { signal: AbortSignal.timeout(2000) });
        const data = await res.json();
        setConnected(true);
        setLastUpdate(new Date().toLocaleTimeString());

        if (Array.isArray(data.leds))     setLedStates(data.leds);
        if (Array.isArray(data.switches)) {
          setSwStates((prev) => {
            data.switches.forEach((sw, i) => {
              if (sw !== prev[i]) addLog(`SW${i+1} ${sw ? "basıldı" : "bırakıldı"}`);
            });
            return data.switches;
          });
        }
        if (data.pattern !== undefined) {
          setActivePattern(data.pattern);
          setBitInput((p) => p === "00000000" ? data.pattern : p);
        }
        if (data.allOn !== undefined) setAllOn(data.allOn);
        if (data.onCount !== undefined) setOnCount(data.onCount);
        if (data.r !== undefined) {
          const hex = `#${data.r.toString(16).padStart(2,"0")}${data.g.toString(16).padStart(2,"0")}${data.b.toString(16).padStart(2,"0")}`;
          if (hex !== "#000000") setLedColor(hex);
        }
        if (data.brightness !== undefined) setBrightness(data.brightness);
      } catch {
        setConnected(false);
      }
    };
    poll();
    pollRef.current = setInterval(poll, 1000);
    return () => clearInterval(pollRef.current);
  }, [addLog]);

  // ── ESP32 log 5 saniyede bir ──────────────────────────────────────────────
  useEffect(() => {
    const fetchLog = async () => {
      try {
        const res = await fetch(`${API}/log`, { signal: AbortSignal.timeout(3000) });
        setServerLog(await res.text());
      } catch { /* sessiz */ }
    };
    fetchLog();
    logPollRef.current = setInterval(fetchLog, 5000);
    return () => clearInterval(logPollRef.current);
  }, []);

  // ── Renk / Parlaklık / Aç-Kapat ──────────────────────────────────────────
  const hexToRgb = (h) => ({
    r: parseInt(h.slice(1,3),16),
    g: parseInt(h.slice(3,5),16),
    b: parseInt(h.slice(5,7),16),
  });

  const sendColor = async (hex) => {
    const { r, g, b } = hexToRgb(hex);
    try {
      await fetch(`${API}/color?r=${r}&g=${g}&b=${b}`);
      addLog(`Renk → R:${r} G:${g} B:${b}`);
    } catch { addLog("Bağlanamadı!"); }
  };

  const handleColorChange = (e) => {
    setLedColor(e.target.value);
    sendColor(e.target.value);
  };

  const sendBrightness = async (val) => {
    try {
      await fetch(`${API}/brightness?value=${val}`);
      addLog(`Parlaklık: %${Math.round(val/2.55)}`);
    } catch { addLog("Bağlanamadı!"); }
  };

  const handleBrightness = (e) => {
    const val = Number(e.target.value);
    setBrightness(val);
    sendBrightness(val);
  };

  const toggleAll = async () => {
    const endpoint = allOn ? "/off" : "/on";
    try {
      await fetch(`${API}${endpoint}`);
      addLog(allOn ? "Tüm LEDler KAPATILDI" : "Tüm LEDler AÇILDI");
    } catch { addLog("Bağlanamadı!"); }
  };

  const sendEffect = async (type) => {
    try {
      await fetch(`${API}/effect?type=${type}`);
      addLog(`Efekt → ${type}`);
    } catch { addLog("Bağlanamadı!"); }
  };

  // ── Pattern editörü ───────────────────────────────────────────────────────
  const toggleBit = (i) => {
    setBitInput((p) => {
      const arr = p.split("");
      arr[i] = arr[i] === "1" ? "0" : "1";
      return arr.join("");
    });
    setBitFeedback(null);
  };

  const handleBitText = (e) => {
    const clean = e.target.value.replace(/[^01]/g, "").slice(0, NUM_LEDS);
    setBitInput(clean.padEnd(NUM_LEDS, "0"));
    setBitFeedback(null);
  };

  const sendPattern = async () => {
    setBitSending(true); setBitFeedback(null);
    try {
      const res  = await fetch(`${API}/8bit`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: bitInput,
      });
      const data = await res.json();
      if (data.status === "ok") {
        setBitFeedback({ ok: true, msg: `Uygulandı: ${data.on}/8 LED açık` });
        addLog(`Pattern gönderildi: ${data.pattern} (${data.on}/8)`);
      }
    } catch {
      setBitFeedback({ ok: false, msg: "ESP32'ye bağlanılamadı!" });
    } finally { setBitSending(false); }
  };

  const loadPattern = async () => {
    try {
      const res  = await fetch(`${API}/8bit`);
      const data = await res.json();
      setBitInput(data.pattern.padEnd(NUM_LEDS,"0"));
      addLog(`Pattern yüklendi: ${data.pattern} (${data.exists ? "dosyadan" : "varsayılan"})`);
    } catch { addLog("Pattern yüklenemedi!"); }
  };

  // ── Log işlemleri ─────────────────────────────────────────────────────────
  const clearServerLog = async () => {
    try {
      await fetch(`${API}/clearlog`);
      setServerLog("");
      addLog("ESP32 log temizlendi");
    } catch { addLog("Log temizlenemedi!"); }
  };

  const dlText = (text, name) => {
    const a = document.createElement("a");
    a.href  = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
  };

  const downloadLog = async () => {
    try {
      const text = await (await fetch(`${API}/log`)).text();
      dlText(text, `esp32-log-${new Date().toISOString().slice(0,10)}.txt`);
      addLog("Log indirildi");
    } catch { addLog("Log indirilemedi!"); }
  };

  const downloadPattern = () => {
    dlText(bitInput, "8bit.txt");
    addLog("8bit.txt indirildi");
  };

  // ── Hesaplamalar ──────────────────────────────────────────────────────────
  const bitOnCount = bitInput.split("").filter(c => c === "1").length;
  const bitDecimal = parseInt(bitInput, 2);

  const presetColors = [
    "#ff0000","#ff6600","#ffff00",
    "#00ff00","#00ffff","#0066ff",
    "#ff00ff","#ffffff",
  ];

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="app">

      {/* HEADER */}
      <header className="header">
        <div className="header-left">
          <div className="logo">IO<span>MON</span></div>
          <div className="subtitle">I/O Monitoring System</div>
        </div>
        <div className={`conn-badge ${connected ? "conn-ok" : "conn-err"}`}>
          <span className="conn-dot" />
          {connected ? `ESP32 Bağlı · ${onCount}/8 LED` : "ESP32 Bağlantı Yok"}
        </div>
      </header>

      <main className="grid">

        {/* ── SWITCH DURUMU ─────────────────────────────────────────────── */}
        <div className="card sw-card">
          <div className="card-label">8 SWITCH DURUMU</div>
          <div className="sw-grid">
            {swStates.map((on, i) => (
              <div key={i} className={`sw-item ${on ? "sw-active" : ""}`}>
                <div className="sw-led-dot" style={ledStates[i] ? {background: ledColor, boxShadow: `0 0 8px ${ledColor}`} : {}} />
                <div className={`sw-badge ${on ? "sw-badge-on" : "sw-badge-off"}`}>
                  {on ? "ON" : "OFF"}
                </div>
                <div className="sw-label">SW{i+1}</div>
              </div>
            ))}
          </div>
          {lastUpdate && <div className="update-time">Son güncelleme: {lastUpdate}</div>}
        </div>

        {/* ── LED KONTROLÜ ──────────────────────────────────────────────── */}
        <div className="card led-card">
          <div className="card-label">LED KONTROLÜ</div>

          {/* 8 LED canlı görüntü */}
          <div className="led8-row">
            {ledStates.map((on, i) => (
              <div key={i} className="led8-col">
                <div
                  className={`led8-circle ${on ? "led8-on" : "led8-off"}`}
                  style={on ? { background: ledColor, boxShadow: `0 0 14px ${ledColor}` } : {}}
                  title={`LED${i+1}: ${on ? "ON" : "OFF"}`}
                >
                  {i+1}
                </div>
              </div>
            ))}
          </div>

          <button className={`toggle-btn ${allOn ? "btn-on" : "btn-off"}`} onClick={toggleAll}>
            {allOn ? "TÜMÜNÜ KAPAT" : "TÜMÜNÜ AÇ"}
          </button>

          <div className="control-row">
            <label>Renk</label>
            <div style={{display:"flex", gap:8, alignItems:"center"}}>
              <input type="color" value={ledColor} onChange={handleColorChange} className="color-input" />
              <div className="presets">
                {presetColors.map((c) => (
                  <button key={c}
                    className={`preset-dot ${ledColor === c ? "active" : ""}`}
                    style={{ background: c }}
                    onClick={() => { setLedColor(c); sendColor(c); }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="control-row">
            <label>Parlaklık <span>{Math.round(brightness/2.55)}%</span></label>
            <input type="range" min="0" max="255" value={brightness}
              onChange={handleBrightness} className="slider" />
          </div>

          <div className="card-label" style={{marginTop:12}}>EFEKTLER</div>
          <div className="effects-row">
            {["rainbow","breathe","chase"].map((e) => (
              <button key={e} className="effect-btn" onClick={() => sendEffect(e)}>
                {e === "rainbow" ? "🌈 Rainbow" : e === "breathe" ? "💨 Breathe" : "🏃 Chase"}
              </button>
            ))}
          </div>
        </div>

        {/* ── 8-BIT PATTERN KART ────────────────────────────────────────── */}
        <div className="card pattern-card">
          <div className="card-label">
            8-BIT PATTERN — 8BIT.TXT &nbsp;
            <span style={{color:"var(--accent)"}}>aktif: </span>
            <code style={{color:"var(--warn)", letterSpacing:4}}>{activePattern}</code>
            <span style={{color:"var(--text2)", marginLeft:8}}>= {parseInt(activePattern,2)} (dec)</span>
          </div>

          <div className="bit-body">
            {/* Toggle butonlar */}
            <div className="bit-editor">
              <div className="bit-toggles-row">
                {Array(NUM_LEDS).fill(null).map((_,i) => (
                  <div key={i} className="bit-toggle-col">
                    <span className="bit-toggle-num">LED{i+1}</span>
                    <button
                      className={`bit-toggle ${bitInput[i]==="1" ? "bit-toggle-on" : "bit-toggle-off"}`}
                      onClick={() => toggleBit(i)}
                      style={bitInput[i]==="1" ? {background:`${ledColor}44`, borderColor:ledColor, color:ledColor} : {}}
                    >
                      {bitInput[i]||"0"}
                    </button>
                    {/* Referans: hangi switch bağlı */}
                    <span className="bit-sw-ref">SW{i+1}</span>
                  </div>
                ))}
              </div>

              <div className="bit-text-row">
                <input
                  type="text"
                  className="bit-text-input"
                  value={bitInput}
                  onChange={handleBitText}
                  maxLength={NUM_LEDS}
                  placeholder="00000000"
                />
                <span className="bit-decimal">=&nbsp;{bitDecimal}&nbsp;(dec)</span>
                <span className="bit-count">
                  <span style={{color:"var(--accent)"}}>{bitOnCount}</span>/8 açık
                </span>
              </div>

              <div className="pattern-actions" style={{marginTop:12}}>
                <button className="pattern-btn pattern-send"
                  onClick={sendPattern} disabled={bitSending || !connected}>
                  {bitSending ? "Gönderiliyor..." : "ESP32'ye Gönder"}
                </button>
                <button className="pattern-btn pattern-load"
                  onClick={loadPattern} disabled={!connected}>
                  Dosyadan Yükle
                </button>
                <button className="pattern-btn pattern-dl" onClick={downloadPattern}>
                  ⬇ 8bit.txt İndir
                </button>
                <button className="pattern-btn pattern-clear"
                  onClick={() => { setBitInput("00000000"); setBitFeedback(null); }}>
                  Sıfırla
                </button>
              </div>

              {bitFeedback && (
                <div className={`pattern-feedback ${bitFeedback.ok?"fb-ok":"fb-err"}`}
                  style={{marginTop:8}}>
                  {bitFeedback.msg}
                </div>
              )}
            </div>

            {/* Sağ: canlı görsel */}
            <div className="bit-live-preview">
              <div className="bit-live-label">ÖNİZLEME</div>
              <div className="bit-preview-leds">
                {Array(NUM_LEDS).fill(null).map((_,i) => (
                  <div key={i}
                    className={`bit-prev-led ${bitInput[i]==="1" ? "bpl-on" : "bpl-off"}`}
                    style={bitInput[i]==="1" ? {background:ledColor, boxShadow:`0 0 10px ${ledColor}`} : {}}
                  >
                    {i+1}
                  </div>
                ))}
              </div>
              <div className="bit-preview-meta">
                Editördeki pattern · tıkla → toggle
              </div>
              <div className="bit-preview-meta" style={{marginTop:4}}>
                {Array(NUM_LEDS).fill(null).map((_,i) => (
                  <button key={i}
                    className="bit-prev-toggle"
                    onClick={() => toggleBit(i)}
                    style={bitInput[i]==="1"?{color:ledColor}:{}}
                  >
                    {bitInput[i]||"0"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── SİSTEM DURUMU ─────────────────────────────────────────────── */}
        <div className="card stats-card">
          <div className="card-label">SİSTEM DURUMU</div>
          <div className="stat-grid">
            <div className="stat">
              <div className="stat-val" style={{color: connected?"#00ff88":"#ff4455"}}>
                {connected ? "✓" : "✗"}
              </div>
              <div className="stat-label">ESP32</div>
            </div>
            <div className="stat">
              <div className="stat-val" style={{color:"var(--warn)"}}>{onCount}/8</div>
              <div className="stat-label">LED Açık</div>
            </div>
            <div className="stat">
              <div className="stat-val" style={{color:"var(--accent2)"}}>
                {Math.round(brightness/2.55)}%
              </div>
              <div className="stat-label">Parlaklık</div>
            </div>
            <div className="stat">
              <div className="stat-val" style={{color: allOn?"var(--accent)":"#666"}}>
                {allOn ? "ON" : "PTN"}
              </div>
              <div className="stat-label">Mod</div>
            </div>
            <div className="stat" style={{gridColumn:"1/-1"}}>
              <div className="stat-val" style={{fontSize:18, letterSpacing:6, color:"var(--warn)"}}>
                {activePattern}
              </div>
              <div className="stat-label">Aktif Pattern</div>
            </div>
          </div>
        </div>

        {/* ── LOG ───────────────────────────────────────────────────────── */}
        <div className="card log-card">
          <div className="log-header">
            <div className="card-label" style={{margin:0}}>EVENT LOG</div>
            <div style={{display:"flex", gap:6, alignItems:"center"}}>
              <div className="log-tabs">
                <button className={`log-tab ${logTab==="ui"?"tab-active":""}`}
                  onClick={()=>setLogTab("ui")}>Arayüz</button>
                <button className={`log-tab ${logTab==="esp32"?"tab-active":""}`}
                  onClick={()=>setLogTab("esp32")}>ESP32</button>
              </div>
              {logTab==="esp32" && (
                <button className="log-icon-btn" onClick={downloadLog} title="Log indir">⬇</button>
              )}
            </div>
          </div>

          {logTab === "ui" ? (
            <div className="log-list">
              {uiLogs.length === 0
                ? <div className="log-empty">Henüz event yok...</div>
                : uiLogs.map((l,i) => <div key={i} className="log-line">{l}</div>)}
            </div>
          ) : (
            <>
              <div className="log-list">
                {serverLog.trim() === ""
                  ? <div className="log-empty">Log dosyası boş...</div>
                  : serverLog.trim().split("\n").reverse().map((l,i) =>
                      <div key={i} className="log-line">{l}</div>)}
              </div>
              <button className="log-clear-btn" onClick={clearServerLog}>
                Log Dosyasını Temizle
              </button>
            </>
          )}
        </div>

      </main>
    </div>
  );
}
