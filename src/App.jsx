import { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";

const ESP32_IP = "192.168.1.6";
const API      = `http://${ESP32_IP}`;
const NUM_LEDS = 8;

export default function App() {
  // Connection
  const [connected, setConnected]   = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  // LED and switch state (from ESP32)
  const [ledStates, setLedStates]   = useState(Array(NUM_LEDS).fill(false));
  const [swStates, setSwStates]     = useState(Array(NUM_LEDS).fill(false));
  const [activePattern, setActivePattern] = useState("00000000");
  const [allOn, setAllOn]           = useState(false);
  const [onCount, setOnCount]       = useState(0);
  const [apMode, setApMode]         = useState(false);

  // Controls
  const [ledColor, setLedColor]     = useState("#ffffff");
  const [brightness, setBrightness] = useState(128);

  // Pattern editor
  const [bitInput, setBitInput]       = useState("00000000");
  const [bitSending, setBitSending]   = useState(false);
  const [bitFeedback, setBitFeedback] = useState(null);

  // Log
  const [uiLogs, setUiLogs]       = useState([]);
  const [serverLog, setServerLog] = useState("");
  const [logTab, setLogTab]       = useState("ui");

  const pollRef     = useRef(null);
  const logPollRef  = useRef(null);
  const fileInputRef = useRef(null);

  const addLog = useCallback((msg) => {
    const t = new Date().toLocaleTimeString();
    setUiLogs((p) => [`[${t}] ${msg}`, ...p].slice(0, 80));
  }, []);

  // ── /status every second ─────────────────────────────────────────────────
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
              if (sw !== prev[i]) {
                if (sw) {
                  const ledOn = Array.isArray(data.leds) ? data.leds[i] : false;
                  addLog(`[Input] SW${i+1} pressed  |  [Output] LED${i+1} ${ledOn ? "ON" : "OFF"}`);
                } else {
                  addLog(`[Input] SW${i+1} released  |  [Output] LED${i+1} ${"OFF"}`);
                }
              }
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
        if (data.apMode !== undefined) setApMode(data.apMode);
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

  // ── ESP32 log every 5 seconds ────────────────────────────────────────────
  useEffect(() => {
    const fetchLog = async () => {
      try {
        const res = await fetch(`${API}/log`, { signal: AbortSignal.timeout(3000) });
        setServerLog(await res.text());
      } catch { /* silent */ }
    };
    fetchLog();
    logPollRef.current = setInterval(fetchLog, 5000);
    return () => clearInterval(logPollRef.current);
  }, []);

  // ── Color / Brightness / Toggle All ──────────────────────────────────────
  const hexToRgb = (h) => ({
    r: parseInt(h.slice(1,3),16),
    g: parseInt(h.slice(3,5),16),
    b: parseInt(h.slice(5,7),16),
  });

  const sendColor = async (hex) => {
    const { r, g, b } = hexToRgb(hex);
    try {
      await fetch(`${API}/color?r=${r}&g=${g}&b=${b}`);
      addLog(`Color → R:${r} G:${g} B:${b}`);
    } catch { addLog("Connection failed!"); }
  };

  const handleColorChange = (e) => {
    setLedColor(e.target.value);
    sendColor(e.target.value);
  };

  const sendBrightness = async (val) => {
    try {
      await fetch(`${API}/brightness?value=${val}`);
      addLog(`Brightness: ${Math.round(val/2.55)}%`);
    } catch { addLog("Connection failed!"); }
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
      addLog(allOn ? "All LEDs OFF" : "All LEDs ON");
    } catch { addLog("Connection failed!"); }
  };

  const sendEffect = async (type) => {
    try {
      await fetch(`${API}/effect?type=${type}`);
      addLog(`Effect → ${type}`);
    } catch { addLog("Connection failed!"); }
  };

  // ── Toggle individual LED (from Switch Status card) ───────────────────────
  const toggleLed = async (i) => {
    const arr = activePattern.split("");
    arr[i] = arr[i] === "1" ? "0" : "1";
    const newPattern = arr.join("");
    try {
      const res = await fetch(`${API}/8bit`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: newPattern,
      });
      const data = await res.json();
      if (data.status === "ok") {
        addLog(`[Manual] LED${i+1} toggled → ${arr[i] === "1" ? "ON" : "OFF"}`);
      }
    } catch { addLog("Connection failed!"); }
  };

  // ── Pattern editor ────────────────────────────────────────────────────────
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
        setBitFeedback({ ok: true, msg: `Applied: ${data.on}/8 LEDs on` });
        addLog(`Pattern sent: ${data.pattern} (${data.on}/8 on)`);
      }
    } catch {
      setBitFeedback({ ok: false, msg: "Failed to connect to ESP32!" });
    } finally { setBitSending(false); }
  };

  // ── Load pattern from .txt file ───────────────────────────────────────────
  const handleFileLoad = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target.result.trim();
      const clean = content.replace(/[^01]/g, "").slice(0, NUM_LEDS).padEnd(NUM_LEDS, "0");
      setBitInput(clean);
      setBitFeedback({ ok: true, msg: `Loaded from file: ${clean}` });
      addLog(`Pattern loaded from file: ${clean}`);
    };
    reader.readAsText(file);
    e.target.value = ""; // reset so same file can be re-selected
  };

  // ── Reset pattern (sends 00000000 to ESP32) ───────────────────────────────
  const resetPattern = async () => {
    setBitInput("00000000");
    setBitFeedback(null);
    try {
      const res = await fetch(`${API}/8bit`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "00000000",
      });
      const data = await res.json();
      if (data.status === "ok") {
        setBitFeedback({ ok: true, msg: "Reset: all LEDs off" });
        addLog("Pattern reset: all LEDs off");
      }
    } catch {
      setBitFeedback({ ok: false, msg: "Failed to connect to ESP32!" });
    }
  };

  // ── Log actions ───────────────────────────────────────────────────────────
  const clearServerLog = async () => {
    try {
      await fetch(`${API}/clearlog`);
      setServerLog("");
      addLog("ESP32 log cleared");
    } catch { addLog("Failed to clear log!"); }
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
      addLog("Log downloaded");
    } catch { addLog("Failed to download log!"); }
  };

  const downloadUiLog = () => {
    if (uiLogs.length === 0) return;
    const text = [...uiLogs].reverse().join("\n");
    dlText(text, `ui-log-${new Date().toISOString().slice(0,10)}.txt`);
    addLog("UI log downloaded");
  };

  const downloadPattern = () => {
    dlText(bitInput, "8bit.txt");
    addLog("8bit.txt downloaded");
  };

  // ── Calculations ──────────────────────────────────────────────────────────
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
          {connected
            ? `ESP32 Connected · ${onCount}/8 LEDs${apMode ? " · 📡 AP Mode" : ""}`
            : "ESP32 Disconnected"}
        </div>
      </header>

      <main className="grid">

        {/* ── SWITCH STATUS ─────────────────────────────────────────────── */}
        <div className="card sw-card">
          <div className="card-label">8 SWITCH STATUS</div>
          <div className="sw-grid">
            {swStates.map((on, i) => (
              <div key={i} className={`sw-item ${on ? "sw-active" : ""}`}>
                <div
                  className="sw-led-dot"
                  style={{
                    ...(ledStates[i] ? { background: ledColor, boxShadow: `0 0 8px ${ledColor}` } : {}),
                    cursor: "pointer",
                  }}
                  title={`Click to toggle LED${i+1}`}
                  onClick={() => toggleLed(i)}
                />
                <div className={`sw-badge ${on ? "sw-badge-on" : "sw-badge-off"}`}>
                  {on ? "ON" : "OFF"}
                </div>
                <div className="sw-label">SW{i+1}</div>
              </div>
            ))}
          </div>
          {lastUpdate && <div className="update-time">Last update: {lastUpdate}</div>}
        </div>

        {/* ── LED CONTROL ───────────────────────────────────────────────── */}
        <div className="card led-card">
          <div className="card-label">LED CONTROL</div>

          {/* 8 LED live view */}
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
            {allOn ? "TURN ALL OFF" : "TURN ALL ON"}
          </button>

          <div className="control-row">
            <label>Color</label>
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
            <label>Brightness <span>{Math.round(brightness/2.55)}%</span></label>
            <input type="range" min="0" max="255" value={brightness}
              onChange={handleBrightness} className="slider" />
          </div>

          <div className="card-label" style={{marginTop:12}}>EFFECTS</div>
          <div className="effects-row">
            {["rainbow","breathe","chase"].map((e) => (
              <button key={e} className="effect-btn" onClick={() => sendEffect(e)}>
                {e === "rainbow" ? "🌈 Rainbow" : e === "breathe" ? "💨 Breathe" : "🏃 Chase"}
              </button>
            ))}
          </div>
        </div>

        {/* ── 8-BIT PATTERN CARD ────────────────────────────────────────── */}
        <div className="card pattern-card">
          <div className="card-label">
            8-BIT PATTERN — 8BIT.TXT &nbsp;
            <span style={{color:"var(--accent)"}}>active: </span>
            <code style={{color:"var(--warn)", letterSpacing:4}}>{activePattern}</code>
            <span style={{color:"var(--text2)", marginLeft:8}}>= {parseInt(activePattern,2)} (dec)</span>
          </div>

          <div className="bit-body">
            {/* Toggle buttons */}
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
                  <span style={{color:"var(--accent)"}}>{bitOnCount}</span>/8 on
                </span>
              </div>

              <div className="pattern-actions" style={{marginTop:12}}>
                <button className="pattern-btn pattern-send"
                  onClick={sendPattern} disabled={bitSending || !connected}>
                  {bitSending ? "Sending..." : "Send to ESP32"}
                </button>

                {/* Hidden file input */}
                <input
                  type="file"
                  accept=".txt"
                  ref={fileInputRef}
                  style={{display:"none"}}
                  onChange={handleFileLoad}
                />
                <button className="pattern-btn pattern-load"
                  onClick={() => fileInputRef.current.click()}>
                  📂 Load from File
                </button>

                <button className="pattern-btn pattern-dl" onClick={downloadPattern}>
                  ⬇ Download 8bit.txt
                </button>
                <button className="pattern-btn pattern-clear"
                  onClick={resetPattern} disabled={!connected}>
                  Reset
                </button>
              </div>

              {bitFeedback && (
                <div className={`pattern-feedback ${bitFeedback.ok?"fb-ok":"fb-err"}`}
                  style={{marginTop:8}}>
                  {bitFeedback.msg}
                </div>
              )}
            </div>

            {/* Right: live preview */}
            <div className="bit-live-preview">
              <div className="bit-live-label">PREVIEW</div>
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
                Editor pattern · click → toggle
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

        {/* ── SYSTEM STATUS ─────────────────────────────────────────────── */}
        <div className="card stats-card">
          <div className="card-label">SYSTEM STATUS</div>
          <div className="stat-grid">
            <div className="stat">
              <div className="stat-val" style={{color: connected?"#00ff88":"#ff4455"}}>
                {connected ? "✓" : "✗"}
              </div>
              <div className="stat-label">ESP32</div>
            </div>
            <div className="stat">
              <div className="stat-val" style={{color:"var(--warn)"}}>{onCount}/8</div>
              <div className="stat-label">LEDs On</div>
            </div>
            <div className="stat">
              <div className="stat-val" style={{color:"var(--accent2)"}}>
                {Math.round(brightness/2.55)}%
              </div>
              <div className="stat-label">Brightness</div>
            </div>
            <div className="stat">
              <div className="stat-val" style={{color: allOn?"var(--accent)":"#666"}}>
                {allOn ? "ON" : "PTN"}
              </div>
              <div className="stat-label">Mode</div>
            </div>
            <div className="stat" style={{gridColumn:"1/-1"}}>
              <div className="stat-val" style={{fontSize:18, letterSpacing:6, color:"var(--warn)"}}>
                {activePattern}
              </div>
              <div className="stat-label">Active Pattern</div>
            </div>
          </div>
        </div>

        {/* ── EVENT LOG ─────────────────────────────────────────────────── */}
        <div className="card log-card">
          <div className="log-header">
            <div className="card-label" style={{margin:0}}>EVENT LOG</div>
            <div style={{display:"flex", gap:6, alignItems:"center"}}>
              <div className="log-tabs">
                <button className={`log-tab ${logTab==="ui"?"tab-active":""}`}
                  onClick={()=>setLogTab("ui")}>UI</button>
                <button className={`log-tab ${logTab==="esp32"?"tab-active":""}`}
                  onClick={()=>setLogTab("esp32")}>ESP32</button>
              </div>
              {logTab === "ui" && (
                <button className="log-icon-btn" onClick={downloadUiLog}
                  title="Download UI log" disabled={uiLogs.length === 0}>⬇</button>
              )}
              {logTab === "esp32" && (
                <button className="log-icon-btn" onClick={downloadLog} title="Download ESP32 log">⬇</button>
              )}
            </div>
          </div>

          {logTab === "ui" ? (
            <div className="log-list">
              {uiLogs.length === 0
                ? <div className="log-empty">No events yet...</div>
                : uiLogs.map((l,i) => <div key={i} className="log-line">{l}</div>)}
            </div>
          ) : (
            <>
              <div className="log-list">
                {serverLog.trim() === ""
                  ? <div className="log-empty">Log file is empty...</div>
                  : serverLog.trim().split("\n").reverse().map((l,i) =>
                      <div key={i} className="log-line">{l}</div>)}
              </div>
              <button className="log-clear-btn" onClick={clearServerLog}>
                Clear Log File
              </button>
            </>
          )}
        </div>

      </main>
    </div>
  );
}
