import React, { useEffect, useMemo, useState } from "react";

/* ====== CONFIG ====== */
const API_BASE =
  process.env.REACT_APP_API || `http://${window.location.hostname}:8000`;
const DEPTS = [
  "ALL",
  "GENEL",
  "DAHILIYE",
  "KBB",
  "KARDIYOLOJI",
  "GOZ",
  "NOROLOJI",
  "CERRAHI",
  "ACIL",
];

// YYYY-MM-DD (Yerel saatle)
const todayStrLocal = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

/* ====== HELPERS ====== */
async function api(path, { method = "GET", token, json } = {}) {
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (json !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status}: ${txt}`);
  }
  return res.headers.get("content-type")?.includes("application/json")
    ? res.json()
    : res.text();
}
const cls = (...a) => a.filter(Boolean).join(" ");
const shortHash = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).slice(0, 6);
};

/* ====== APP ====== */
export default function App() {
  /* auth */
  const [session, setSession] = useState(null);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginErr, setLoginErr] = useState("");

  // ilk yüklemede session + gün + autoDate oku
  useEffect(() => {
    const s = localStorage.getItem("ia_session");
    if (s) setSession(JSON.parse(s));

    const savedDay = localStorage.getItem("ia_day");
    const savedAuto = localStorage.getItem("ia_autodate");
    if (savedDay) setDay(savedDay);
    if (savedAuto != null) setAutoDate(savedAuto === "1");
  }, []);

  /* ui state */
  const [tab, setTab] = useState("home"); // home | note | report
  const [dept, setDept] = useState("ALL");
  const [day, setDay] = useState(todayStrLocal());

  // Kullanıcı elle tarih seçmediyse gece yarısı otomatik bugüne çek
  const [autoDate, setAutoDate] = useState(true);
  useEffect(() => {
    const tick = () => {
      const now = todayStrLocal();
      if (autoDate && day !== now) setDay(now);
    };
    const id = setInterval(tick, 60000);
    document.addEventListener("visibilitychange", tick);
    tick();
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [autoDate, day]);

  // day & autoDate kalıcı olsun
  useEffect(() => {
    localStorage.setItem("ia_day", day);
  }, [day]);
  useEffect(() => {
    localStorage.setItem("ia_autodate", autoDate ? "1" : "0");
  }, [autoDate]);

  /* patients + selection */
  const [patients, setPatients] = useState({});
  const [selectedPatientId, setSelectedPatientId] = useState(null);

  // TC alanı (tam 11 rakam)
  const [tcInput, _setTcInput] = useState("");
  const setTcInput = (val) => {
    const digits = (val || "").replace(/\D+/g, "").slice(0, 11);
    _setTcInput(digits);
  };
  const isTcValid = tcInput.length === 11;

  const [labelInput, setLabelInput] = useState("");

  useEffect(() => {
    const p = localStorage.getItem("ia_patients");
    if (p) setPatients(JSON.parse(p));
  }, []);
  useEffect(() => {
    localStorage.setItem("ia_patients", JSON.stringify(patients));
  }, [patients]);

  // Listeyi SEÇİLİ GÜN + BÖLÜM filtresine göre oluştur
  const patientList = useMemo(() => {
    const isAll = (dept || "ALL") === "ALL";
    const dayStr = day;

    const out = [];
    for (const p of Object.values(patients)) {
      const todays = (p.visits || []).filter((v) => {
        const okDay = (v.ts || "").slice(0, 10) === dayStr;
        const okDept =
          isAll || (v.department || "GENEL").toUpperCase() === dept;
        return okDay && okDept;
      });

      const serverCount = typeof p.countToday === "number" ? p.countToday : 0;
      const count = todays.length > 0 ? todays.length : serverCount;

      if (count > 0) {
        const lastTs =
          todays.length > 0
            ? todays[todays.length - 1].ts
            : p.lastVisitTs || null;

        out.push({
          ...p,
          countToday: count,
          lastVisitTs: lastTs,
        });
      }
    }

    out.sort((a, b) => (b.lastVisitTs || "").localeCompare(a.lastVisitTs || ""));
    return out;
  }, [patients, day, dept]);

  const selectedPatient = selectedPatientId ? patients[selectedPatientId] : null;

  /* reports */
  const [serverReport, setServerReport] = useState(null);
  const [deptFeed, setDeptFeed] = useState(null);

  /* loading + sert yenile */
  const [loadingList, setLoadingList] = useState(false);

  const fetchReport = async () => {
    if (!session) return;
    const r = await api(
      `/reports/daily?department=${dept}&day=${day}`,
      { token: session.token }
    );
    setServerReport(r);
  };

  const fetchDeptFeed = async () => {
    if (!session) return;
    const r = await api(
      `/visits/by_department?department=${dept}&day=${day}&limit=200`,
      { token: session.token }
    );
    setDeptFeed(r?.by_author || {});
  };

  // >>> GÜNCEL: sadece seçili gün+bölüm hastalarını state'e koyar, diğerlerini temizler
  const fetchPatientsForDay = async () => {
    if (!session) return;

    setLoadingList(true);
    try {
      let data = null;
      try {
        data = await api(
          `/patients/list?department=${dept}&day=${day}`,
          { token: session.token }
        );
      } catch (e) {
        console.warn("patients/list hata:", e);
      }

      const next = {};
      const prev = patients || {};
      const serverItems = data?.items || [];

      if (serverItems.length > 0) {
        for (const it of serverItems) {
          const prevVisits = prev[it.patient_id]?.visits || [];
          next[it.patient_id] = {
            id: it.patient_id,
            label: it.label || "",
            visits: prevVisits, // ayrıntı çekildiyse koru
            countToday: it.count_today || 0,
            lastVisitTs: it.last_visit_ts || null,
          };
        }
      } else {
        // Sunucu boş ise localden bugüne/bölüme uyanları çıkart
        const isAll = (dept || "ALL") === "ALL";
        for (const p of Object.values(prev)) {
          const todays = (p.visits || []).filter((v) => {
            const okDay = (v.ts || "").slice(0, 10) === day;
            const okDept =
              isAll || (v.department || "GENEL").toUpperCase() === dept;
            return okDay && okDept;
          });
          if (todays.length > 0) {
            next[p.id] = {
              id: p.id,
              label: p.label || "",
              visits: p.visits || [],
              countToday: todays.length,
              lastVisitTs: todays[todays.length - 1].ts,
            };
          }
        }
      }
              // Seçili hastayı, viziti olmasa da state’te tut (Not paneli titremesin)
if (selectedPatientId && patients[selectedPatientId]) {
  if (!next[selectedPatientId]) {
    next[selectedPatientId] = patients[selectedPatientId];
  }
}
       
      // Kritik: merge ETME, direkt değiştir (eski günler tamamen silinsin)
      setPatients(next);
    } finally {
      setLoadingList(false);
    }
  };

  // Ayrıntı (departmandan bağımsız)
  const fetchPatient = async (pid) => {
    if (!session || !pid) return;
    const data = await api(`/patients/${pid}/visits?day=${day}`, {
      token: session.token,
    });
    if (!data || !Array.isArray(data.visits)) return;
    setPatients((prev) => {
      const prevP = prev[data.patient_id] || {
        id: data.patient_id,
        label: data.label || "",
        visits: [],
      };
      if ((data.visits || []).length === 0 && (prevP.visits || []).length > 0)
        return prev; // boş gelirse silme
      return {
        ...prev,
        [data.patient_id]: {
          id: data.patient_id,
          label: data.label || prevP.label || "",
          visits: data.visits || [],
        },
      };
    });
  };

  // Seçimi opsiyonel koruyan sert yenileme
  const hardRefresh = async (keepSelection = true) => {
    if (!session) return;
    setLoadingList(true);
    if (!keepSelection) setSelectedPatientId(null);
    try {
      await fetchPatientsForDay();
      if (tab === "report") {
        await Promise.all([fetchReport(), fetchDeptFeed()]);
      }
    } finally {
      setLoadingList(false);
    }
  };
  
  // ---- AI Gün Sonu PDF (hocaya özel)
async function downloadRollupPdf() {
  if (!session) return;
  try {
    const q = `?day=${day}&department=${dept}`;
    const res = await fetch(`${API_BASE}/ai/rollup.pdf${q}`, {
      headers: { Authorization: "Bearer " + session.token },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || "PDF alınamadı");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rapor-${dept}-${day}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert("PDF indirilemedi: " + (err?.message || String(err)));
  }
}


  /* ====== EFFECTS ====== */
  useEffect(() => {
  if (!session) return;
  hardRefresh(true); // seçimi KORU
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [session, dept, day, tab]);


  useEffect(() => {
    if (!session || !selectedPatientId) return;
    fetchPatient(selectedPatientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, selectedPatientId, day, tab]);

  /* ====== AUTH ====== */
  const onLogin = async (e) => {
    e?.preventDefault?.();
    try {
      const form = new URLSearchParams();
      form.set("username", loginUser.trim().toLowerCase());
      form.set("password", loginPass);

      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      if (!res.ok) throw new Error("Giriş hatalı");

      const data = await res.json();
      const sess = {
        username: data.username,
        displayName: data.display_name,
        token: data.access_token,
        role: data.role,
      };
      setSession(sess);
      localStorage.setItem("ia_session", JSON.stringify(sess));

      setDay(todayStrLocal());
      setAutoDate(true);
    } catch (err) {
      console.error("login error:", err);
      setLoginErr(err.message || String(err));
    }
  };

  const onLogout = () => {
    setSession(null);
    setPatients({});
    setSelectedPatientId(null);
    setTab("home");
    localStorage.removeItem("ia_session");
    localStorage.removeItem("ia_patients");
  };

  /* ====== ACTIONS ====== */
  const createOrSelectFromTC = async () => {
    try {
      if (!session) return;
      if (!isTcValid) throw new Error("TC tam 11 rakam olmalı");
      const d = await api(`/patients/derive`, {
        method: "POST",
        token: session.token,
        json: { tc: tcInput },
      });
      const id = d.patient_id;
      const p = await api(`/patients`, {
        method: "POST",
        token: session.token,
        json: {
          patient_id: id,
          label: labelInput.trim() || "Etiket eklenmedi",
        },
      });
      setPatients((prev) => ({
        ...prev,
        [p.patient_id]:
          prev[p.patient_id] || { id: p.patient_id, label: p.label, visits: [] },
      }));
      setSelectedPatientId(id);
      setTab("note");
      await fetchPatient(id);
      
    } catch (e) {
      alert("Hasta açılırken hata: " + e.message);
    }
  };

  const addVisit = async (payload) => {
    if (!selectedPatientId || !session) return;
    try {
      const department = (payload.department || "").toUpperCase() || "GENEL";

      const res = await api(`/visits`, {
        method: "POST",
        token: session.token,
        json: {
          patient_id: selectedPatientId,
          text: payload.text,
          ops_drug: !!payload.ops?.drug,
          ops_test: !!payload.ops?.test,
          ops_consult: !!payload.ops?.consult,
          ops_critical: !!payload.ops?.critical,
          department,
        },
      });
      const newId = res?.id ?? res?.visit_id ?? res?.data?.id ?? res?.data?.visit_id;

      // optimistic local
      setPatients((prev) => {
        const p = prev[selectedPatientId] || {
          id: selectedPatientId,
          label: "",
          visits: [],
        };
        const visits = [
          ...(p.visits || []),
          {
            id: newId,
            ts: new Date().toISOString(),
            author: session.displayName,
            text: payload.text,
            ops: {
              drug: !!payload.ops?.drug,
              test: !!payload.ops?.test,
              consult: !!payload.ops?.consult,
              critical: !!payload.ops?.critical,
            },
            department,
          },
        ];
        return { ...prev, [selectedPatientId]: { ...p, visits } };
      });

      await fetchPatient(selectedPatientId);
      await Promise.all([fetchReport(), fetchDeptFeed(), fetchPatientsForDay()]);
      await hardRefresh(true); // seçim kalsın, listeler/rapor tazelensin
    } catch (e) {
      alert("Kaydetme hatası: " + e.message);
    }
  };

  const updateVisit = async (visitId, patch) => {
    if (!session) return;

    // Optimistic update
    if (selectedPatientId) {
      setPatients((prev) => {
        const p = prev[selectedPatientId];
        if (!p) return prev;
        const visits = (p.visits || []).map((v) =>
          v.id === visitId
            ? {
                ...v,
                text: patch.text ?? v.text,
                ops: {
                  drug: patch.ops_drug ?? v.ops?.drug,
                  test: patch.ops_test ?? v.ops?.test,
                  consult: patch.ops_consult ?? v.ops?.consult,
                  critical: patch.ops_critical ?? v.ops?.critical,
                },
                edited_at: new Date().toISOString(),
              }
            : v
        );
        return { ...prev, [selectedPatientId]: { ...p, visits } };
      });
    }

    await api(`/visits/${visitId}`, {
      method: "PUT",
      token: session.token,
      json: patch,
    });

    const tasks = [];
    if (selectedPatientId) tasks.push(fetchPatient(selectedPatientId));
    tasks.push(fetchReport(), fetchDeptFeed(), fetchPatientsForDay());
    await Promise.all(tasks);
    await hardRefresh(true);
  };

const deleteVisit = async (visitId) => {
  if (!session || !selectedPatientId) return;
  try {
    await api(`/visits/${visitId}`, { method: "DELETE", token: session.token });

    // (Opsiyonel) yerel state’ten de anında çıkarıp görsel geri bildirim
    setPatients((prev) => {
      const p = prev[selectedPatientId];
      if (!p) return prev;
      const visits = (p.visits || []).filter((v) => v.id !== visitId);
      return { ...prev, [selectedPatientId]: { ...p, visits } };
    });

    // Gerçek F5 etkisi: tüm ekranı yeniden yükle
    window.location.reload();
  } catch (e) {
    alert("Silme hatası: " + (e?.message || e));
  }
};

  /* ====== RENDER ====== */
  if (!session) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white font-bold">
              IA
            </span>
            <div>
              <div className="font-semibold">Intern Asistan</div>
              <div className="text-xs text-slate-500">
                Demo: e.sude / a.yilmaz / m.demir / burcin.hoca — şifre 1234
              </div>
            </div>
          </div>
          <form onSubmit={onLogin} className="grid gap-3">
            <div>
              <label className="text-xs text-slate-500">Kullanıcı</label>
              <input
                value={loginUser}
                onChange={(e) => setLoginUser(e.target.value)}
                className="mt-1 w-full rounded-xl border px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Şifre</label>
              <input
                type="password"
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                className="mt-1 w-full rounded-xl border px-3 py-2"
              />
            </div>
            {loginErr && <div className="text-sm text-rose-600">{loginErr}</div>}
            <button className="mt-1 px-4 py-2 rounded-xl bg-blue-600 text-white">
              Giriş Yap
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <TopBar session={session} onLogout={onLogout} />
      <Toolbar
        dept={dept}
        setDept={(d) => { setDept(d); }}   // effect içinde hardRefresh tetikleniyor
        day={day}
        setDay={(d) => { setDay(d); setAutoDate(false); }}
        autoDate={autoDate}
        setAutoDate={setAutoDate}
        onRefresh={hardRefresh}
        loading={loadingList}
      />
      <div className="max-w-5xl mx-auto p-4 grid md:grid-cols-2 gap-6">
        <LeftPane
          key={`${day}-${dept}`}  // filtre değişince baştan kur
          {...{
            session,
            tab,
            setTab,
            patients,
            patientList,
            selectedPatientId,
            setSelectedPatientId,
            tcInput,
            setTcInput,
            labelInput,
            setLabelInput,
            createOrSelectFromTC,
            loadingList,
            day,
            dept,
            isTcValid,
          }}
        />
        <RightPane
          {...{
            session,
            tab,
            setTab,
            selectedPatient,
            dept,
            addVisit,
            deleteVisit,
            updateVisit,
            serverReport,
            deptFeed,
            day,
            deptSel: dept,

            token:session.token,
          
            refresh: () => {
              fetchReport();
              fetchDeptFeed();
            },
                onDownloadPdf: downloadRollupPdf,

          }}
        />
      </div>
      <FooterBar current={tab} onChange={setTab} />
    </div>
  );
}

/* ====== UI pieces ====== */
function TopBar({ session, onLogout }) {
  return (
    <div className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-white font-bold">
            IA
          </span>
          <span className="font-semibold">Intern Asistan</span>
        </div>
        <div className="text-sm flex items-center gap-3">
          <span>
            👤 {session.displayName} <em className="text-slate-400">({session.role})</em>
          </span>
          <button onClick={onLogout} className="px-3 py-1 rounded-lg bg-slate-100">
            Çıkış
          </button>
        </div>
      </div>
    </div>
  );
}

function Toolbar({ dept, setDept, day, setDay, autoDate, setAutoDate, onRefresh, loading }) {
  return (
    <div className="bg-white border-b">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
        <div className="text-sm text-slate-600">Bölüm:</div>
        <select
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          className="px-3 py-2 rounded-xl border"
        >
          {DEPTS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-slate-600">Tarih:</span>
          <input
            type="date"
            value={day}
            onChange={(e) => { setDay(e.target.value); setAutoDate(false); }}
            className="px-3 py-2 rounded-xl border"
          />
          {!autoDate && (
            <button
              onClick={() => { setDay(todayStrLocal()); setAutoDate(true); }}
              className="px-2 py-1 rounded-lg bg-slate-100 text-xs"
              title="Bugüne dön ve otomatik güncelle"
            >
              Bugün
            </button>
          )}
          <button
  onClick={() => onRefresh(true)}   // seçimi koru
  className="px-3 py-2 rounded-xl bg-slate-100 text-sm"
  disabled={loading}
  title="Listeyi ve raporu yenile"
>
  {loading ? "Yükleniyor..." : "Yenile"}
</button>

        </div>
      </div>
    </div>
  );
}

function LeftPane(props) {
  const {
    session,
    tab,
    setTab,
    patientList,
    selectedPatientId,
    setSelectedPatientId,
    tcInput,
    setTcInput,
    labelInput,
    setLabelInput,
    createOrSelectFromTC,
    loadingList,
    day,
    dept,
    isTcValid,
  } = props;

  return (
    <div className="bg-white border rounded-2xl p-4 shadow-sm">
      <h2 className="text-xl font-semibold">Hasta Seç / Oluştur</h2>
      <p className="text-sm text-slate-500 mt-1">
        Aktif: <b>{session.displayName}</b>
      </p>

      <div className="mt-4 grid sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <label className="text-xs text-slate-500">TC Kimlik</label>
          <input
            value={tcInput}
            onChange={(e) => setTcInput(e.target.value)}
            placeholder="11 haneli TC"
            inputMode="numeric"
            pattern="\d*"
            maxLength={11}
            className="mt-1 w-full rounded-xl border px-3 py-2"
          />
          <div className="text-[11px] text-slate-500 mt-1">
            {tcInput.length}/11
          </div>
        </div>
        <div className="sm:col-span-1">
          <label className="text-xs text-slate-500">Hasta Etiketi</label>
          <input
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            placeholder="Yatak 12 / KOAH"
            className="mt-1 w-full rounded-xl border px-3 py-2"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={createOrSelectFromTC}
          disabled={!isTcValid}
          className={cls(
            "px-4 py-2 rounded-xl text-white",
            isTcValid ? "bg-blue-600" : "bg-slate-300 cursor-not-allowed"
          )}
          title={!isTcValid ? "TC tam 11 rakam olmalı" : "Hastayı Aç"}
        >
          Hastayı Aç
        </button>
        {isTcValid && (
          <span className="text-xs text-slate-500">
            (Yerel önizleme) ID: <b>PX-{shortHash(tcInput)}</b>
          </span>
        )}
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">
            Kayıtlı Hastalar
            <span className="ml-2 text-xs text-slate-500">
              ({day} • {dept})
            </span>
          </h3>
          <TabPills tab={tab} setTab={setTab} />
        </div>

        <div className="mt-3 grid gap-2 max-h-80 overflow-y-auto pr-1">
  {loadingList ? (
    <div className="text-sm text-slate-500">Yükleniyor…</div>
  ) : patientList.length > 0 ? (
    patientList.map((p) => (

              <button
                key={p.id}
                onClick={() => {
                  setSelectedPatientId(p.id);
                  setTab("note");
                }}
                className={cls(
                  "text-left p-3 rounded-xl border",
                  selectedPatientId === p.id
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-200 bg-white"
                )}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{p.id}</div>
                    <div className="text-sm text-slate-500">{p.label}</div>
                  </div>
                  <div className="text-xs text-slate-500">
                    Vizit: <b>{p.countToday ?? p.visits?.length ?? 0}</b>
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="text-sm text-slate-500">Kayıt yok.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function RightPane({
  session,
  tab,
  setTab,
  selectedPatient,
  dept,
  addVisit,
  deleteVisit,
  updateVisit,
  serverReport,
  deptFeed,
  day,
  deptSel,
  refresh,
  onDownloadPdf,
  token,

}) {
 async function downloadPdf() {
  try {
    const params = new URLSearchParams();
    params.set("day", day);
    params.set("department", dept || "ALL");   // ✅ burası düzeltildi

    const res = await fetch(`${API_BASE}/reports/daily_pdf?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${session.token}` }, // ✅ token da session'dan gelsin
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`${res.status}: ${txt}`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gunsonu_${dept || "ALL"}_${day}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert("PDF indirilemedi: " + (e?.message || e));
  }
}


  return (
    <div className="bg-white border rounded-2xl p-4 shadow-sm">
      {tab === "home" && <HomePanel />}
      {tab === "note" && (
        <NotePanel
          patient={selectedPatient}
          addVisit={addVisit}
          session={session}
          dept={dept}
          onDelete={deleteVisit}
          onUpdate={updateVisit}
        />
      )}
      {tab === "report" && (
        <ReportPanel
          seen={serverReport?.patients_seen || 0}
          totals={
            serverReport?.totals || {
              critical: 0,
              drugs: 0,
              tests: 0,
              consults: 0,
            }
          }
          lines={serverReport?.lines || ["Önemli kritik bulgu kaydı yok."]}
          perfDetail={serverReport?.by_author_detail || {}}
          deptFeed={deptFeed || {}}
          department={deptSel}
          role={session.role}
          onRefresh={refresh}
          onDownloadPdf={onDownloadPdf}
          token={token}
          day={day}
        />
      )}
    </div>
  );
}

/* ====== PANELS ====== */
function HomePanel() {
  return (
    <div>
      <h2 className="text-xl font-semibold">Gün Özeti</h2>
      <p className="text-sm text-slate-500">Soldan hasta seçin veya rapora geçin.</p>
    </div>
  );
}

function NotePanel({ patient, addVisit, session, dept, onDelete, onUpdate }) {
  const [text, setText] = useState("");
  const [ops, setOps] = useState({
    drug: false,
    test: false,
    consult: false,
    critical: false,
  });

  // Vizit için bölüm seçimi (varsayılan: üstte seçili; ALL ise ACIL)
  const DEPT_OPTIONS = ["GENEL", "DAHILIYE", "KBB", "KARDIYOLOJI", "GOZ", "NOROLOJI", "CERRAHI", "ACIL"];
  const initialDept = useMemo(() => (dept === "ALL" ? "ACIL" : dept), [dept]);
  const [visitDept, setVisitDept] = useState(initialDept);
  useEffect(() => { setVisitDept(initialDept); }, [initialDept]);

  if (!patient) return <div className="text-slate-500">Soldan hasta seçin.</div>;

  const onSave = () => {
    if (!text.trim() || text.trim().length < 20)
      return alert("En az 20 karakterlik anlamlı bir not girin.");
    addVisit({ text: text.trim(), ops, department: visitDept });
    setText("");
    setOps({ drug: false, test: false, consult: false, critical: false });
  };

  return (
    <div>
      <h2 className="text-xl font-semibold">{patient.id}</h2>
      <p className="text-sm text-slate-500">{patient.label}</p>

      {/* Bölüm seçici */}
      <div className="mt-3">
        <label className="text-xs text-slate-500">Bu vizitin bölümü</label>
        <select
          value={visitDept}
          onChange={(e) => setVisitDept(e.target.value)}
          className="mt-1 px-3 py-2 rounded-xl border"
        >
          {DEPT_OPTIONS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        {dept === "ALL" && (
          <div className="text-xs text-amber-600 mt-1">
            Üstte bölüm “ALL”. Vizit <b>{visitDept}</b> olarak kaydedilecek.
          </div>
        )}
      </div>

      <div className="mt-4">
        <label className="text-xs text-slate-500">Semptom / Bulgular</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="mt-1 w-full min-h-[120px] rounded-xl border px-3 py-2"
          placeholder="Örn: TA 100/60, SpO2 94, ateş 37.8; analjezik verildi."
        />
      </div>

      <div className="mt-3 grid sm:grid-cols-4 gap-2">
        <Check label="İlaç" checked={ops.drug} onChange={(v) => setOps((o) => ({ ...o, drug: v }))} />
        <Check label="Tetkik" checked={ops.test} onChange={(v) => setOps((o) => ({ ...o, test: v }))} />
        <Check label="Konsültasyon" checked={ops.consult} onChange={(v) => setOps((o) => ({ ...o, consult: v }))} />
        <Check label="Kritik Hasta" checked={ops.critical} onChange={(v) => setOps((o) => ({ ...o, critical: v }))} />
      </div>

      <div className="mt-3">
        <button onClick={onSave} className="px-4 py-2 rounded-xl bg-blue-600 text-white">
          Kaydet
        </button>
      </div>

      <div className="mt-6">
        <h3 className="font-medium">Geçmiş Vizitler</h3>
        <div className="mt-2 grid gap-2">
          {(patient.visits || []).slice().reverse().map((v, i) => (
            <VisitCard
              key={v.id ?? i}
              v={v}
              session={session}
              onDelete={() => onDelete(v.id)}
              onUpdate={onUpdate}
            />
          ))}
          {(!patient.visits || patient.visits.length === 0) && (
            <div className="text-sm text-slate-500">Bu hastada vizit yok.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function VisitCard({ v, session, onDelete, onUpdate }) {
  const [edit, setEdit] = useState(false);
  const [etext, setEtext] = useState(v.text || "");
  const [eops, setEops] = useState(v.ops || {});
  const canEdit = v.author === session?.displayName;

  const save = async () => {
    await onUpdate(v.id, {
      text: etext,
      ops_drug: !!eops.drug,
      ops_test: !!eops.test,
      ops_consult: !!eops.consult,
      ops_critical: !!eops.critical,
    });
    setEdit(false);
  };

  return (
    <div className="p-3 border rounded-xl">
      <div className="text-xs text-slate-500 flex items-center gap-2">
        <span>{new Date(v.ts).toLocaleString()}</span>
        <span className="opacity-50">•</span>
        <span>
          Yazan: <b>{v.author || "?"}</b>
        </span>
        {v.department && <Badge tone="blue">{v.department}</Badge>}
        {v.edited_at && (
          <Badge tone="amber">düzenlendi: {new Date(v.edited_at).toLocaleString()}</Badge>
        )}
      </div>

      {!edit ? (
        <>
          <div className="mt-1">{v.text}</div>
          <div className="mt-1 text-xs text-slate-500 flex items-center gap-3">
            {v.ops?.drug && <Badge tone="emerald">İlaç</Badge>}
            {v.ops?.test && <Badge tone="blue">Tetkik</Badge>}
            {v.ops?.consult && <Badge tone="violet">Konsültasyon</Badge>}
            {v.ops?.critical && <Badge tone="rose">Kritik</Badge>}
            {canEdit && (
              <span className="ml-auto flex items-center gap-3">
                <button onClick={() => setEdit(true)} className="text-blue-600 text-xs hover:underline">
                  Düzenle
                </button>
                <button onClick={onDelete} className="text-rose-600 text-xs hover:underline">
                  Sil
                </button>
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="mt-2 grid gap-2">
          <textarea
            value={etext}
            onChange={(e) => setEtext(e.target.value)}
            className="w-full rounded-xl border px-3 py-2 min-h-[100px]"
          />
          <div className="grid sm:grid-cols-4 gap-2">
            <Check label="İlaç" checked={!!eops.drug} onChange={(x) => setEops((o) => ({ ...o, drug: x }))} />
            <Check label="Tetkik" checked={!!eops.test} onChange={(x) => setEops((o) => ({ ...o, test: x }))} />
            <Check label="Konsültasyon" checked={!!eops.consult} onChange={(x) => setEops((o) => ({ ...o, consult: x }))} />
            <Check label="Kritik" checked={!!eops.critical} onChange={(x) => setEops((o) => ({ ...o, critical: x }))} />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={save} className="px-3 py-1 rounded-lg bg-blue-600 text-white text-sm">
              Kaydet
            </button>
            <button onClick={() => setEdit(false)} className="px-3 py-1 rounded-lg bg-slate-100 text-sm">
              İptal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportPanel({
  seen,
  totals,
  lines,
  perfDetail,
  deptFeed,
  department,
  role,
  onRefresh,
  onDownloadPdf,
  
  
})

{
// --- Öğrenci filtresi için arama + favoriler ---
const [authorFilter, setAuthorFilter] = useState(""); // "" = hepsi
const [authorQuery, setAuthorQuery] = useState("");

// favoriler (localStorage)
const [favorites, setFavorites] = useState(() => {
  try { return JSON.parse(localStorage.getItem("ia_favs") || "[]"); }
  catch { return []; }
});
useEffect(() => {
  localStorage.setItem("ia_favs", JSON.stringify(favorites));
}, [favorites]);

const toggleFav = (name) => {
  setFavorites((f) =>
    f.includes(name) ? f.filter((x) => x !== name) : [...f, name]
  );
};

const authorsAll = Object.keys(perfDetail || {}); // ekranda görünen öğrenci isimleri

// arama + favori-öncelik + limit
const authorsFiltered = authorsAll
  .filter((a) => a.toLowerCase().includes(authorQuery.toLowerCase()))
  .sort((a, b) => {
    const fa = favorites.includes(a) ? 1 : 0;
    const fb = favorites.includes(b) ? 1 : 0;
    if (fa !== fb) return fb - fa;   // favoriler önce
    return a.localeCompare(b, "tr");
  })
  .slice(0, 50);

// perfDetail & deptFeed ekrana basmadan önce (mevcut mantığınla aynı)
const displayPerfDetail = authorFilter
  ? Object.fromEntries(
      Object.entries(perfDetail || {}).filter(([k]) => k === authorFilter)
    )
  : (perfDetail || {});

const displayDeptFeed = authorFilter
  ? Object.fromEntries(
      Object.entries(deptFeed || {}).filter(([k]) => k === authorFilter)
    )
  : (deptFeed || {});


  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
  <h2 className="text-xl font-semibold">Gün Sonu Raporu</h2>
<div className="flex items-center gap-2 flex-wrap justify-end">
  {/* Yenile */}
  <button
    onClick={onRefresh}
    className="px-3 py-1.5 rounded-lg bg-slate-100 text-sm hover:bg-slate-200 whitespace-nowrap"
  >
    Yenile
  </button>

  {(role === "supervisor" || role === "admin") && (
    <>
      {/* Öğrenci arama */}
      <input
        value={authorQuery}
        onChange={(e) => setAuthorQuery(e.target.value)}
        placeholder="Öğrenci ara…"
        className="px-2 py-1.5 rounded-lg border text-sm w-40 md:w-48"
      />

      {/* Öğrenci seç */}
      <select
        value={authorFilter}
        onChange={(e) => setAuthorFilter(e.target.value)}
        className="px-2 py-1.5 rounded-lg border text-sm"
        title="Öğrenci filtresi"
      >
        <option value="">Tüm öğrenciler</option>
        {authorsFiltered.map((a) => (
          <option key={a} value={a}>
            {favorites.includes(a) ? "★ " : ""}{a}
          </option>
        ))}
      </select>

      {/* Favori toggle */}
      <button
        onClick={() => authorFilter && toggleFav(authorFilter)}
        disabled={!authorFilter}
        className="px-2 py-1.5 rounded-lg border text-sm disabled:opacity-50"
        title={authorFilter ? `${authorFilter} favorilere ekle/çıkar` : "Öğrenci seç"}
      >
        {authorFilter && favorites.includes(authorFilter) ? "★" : "☆"}
      </button>

      {/* Filtreyi temizle */}
      <button
        onClick={() => { setAuthorFilter(""); setAuthorQuery(""); }}
        className="px-2 py-1.5 rounded-lg bg-slate-100 text-sm hover:bg-slate-200 whitespace-nowrap"
        title="Filtreyi temizle"
      >
        Temizle
      </button>

      {/* AI PDF (daha şık) */}
      <button
        onClick={onDownloadPdf}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm hover:bg-violet-700 shadow-sm whitespace-nowrap"
        title="Seçili bölüm/gün için AI özet PDF indir"
      >
        <IconWand className="h-4 w-4" />
        AI Gün Sonu (PDF)
      </button>
    </>
  )}
</div>

</div>


      <div className="mt-4 grid sm:grid-cols-3 gap-3">
        <StatCard label="Görülen Hasta" value={seen} />
        <StatCard label="Kritik" value={totals.critical || 0} tone="rose" />
        <StatCard label="İlaç" value={totals.drugs || 0} tone="emerald" />
      </div>

      <div className="mt-4 p-4 border rounded-2xl">
        <div className="font-medium mb-2">Öğrenci Özeti (Bugün)</div>
        {Object.keys(displayPerfDetail || {}).length === 0 ? (
          <div className="text-sm text-slate-500">Kayıt yok.</div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {Object.entries(displayPerfDetail).map(([who, info]) => (
              <div key={who} className="p-3 border rounded-xl">
                <div className="font-medium">{who}</div>
                <div className="text-sm text-slate-600 mt-1">
                  Hasta: <b>{info.patients}</b> • Vizit: <b>{info.visits}</b> • Kritik:{" "}
                  <b>{info.critical}</b>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 p-4 border rounded-2xl">
        <div className="font-medium mb-2">Bölüm Akışı — {department}</div>
        {(!displayDeptFeed || Object.keys(displayDeptFeed).length === 0) && (
          <div className="text-sm text-slate-500">Akış boş.</div>
        )}
        <div className="grid gap-4 max-h-[500px] overflow-y-auto pr-1">
  {Object.entries(displayDeptFeed || {}).map(([who, arr]) => (
    <div key={who} className="border rounded-xl">

              <div className="px-3 py-2 border-b bg-slate-50 text-sm font-medium">
                {who} — {arr.length} kayıt
              </div>
              <div className="p-3 grid gap-2">
                {arr.map((v) => (
                  <div key={v.id} className="p-3 border rounded-lg">
                    <div className="text-xs text-slate-500 flex items-center gap-2">
                      <span>{new Date(v.ts).toLocaleString()}</span>
                      <span className="opacity-50">•</span>
                      <span className="font-mono">{v.patient_id}</span>
                      {v.department && <Badge tone="blue">{v.department}</Badge>}
                      {v.ops?.critical && <Badge tone="rose">Kritik</Badge>}
                      {v.edited_at && <Badge tone="amber">düzenlendi</Badge>}
                    </div>
                    <div className="mt-1 text-sm">{v.text}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {role !== "supervisor" && role !== "admin" && (
          <div className="mt-2 text-xs text-slate-500">
            Not: Öğrenciler akışta yalnızca kendi vizitlerini görür.
          </div>
        )}
      </div>

      <div className="mt-4 p-4 border rounded-2xl bg-slate-50">
        <div className="font-medium">Özet</div>
        <ul className="list-disc pl-5 text-slate-700 mt-2">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ====== atoms ====== */
function TabPills({ tab, setTab }) {
  const items = [
    ["home", "Günlük"],
    ["note", "Not"],
    ["report", "Rapor"],
  ];
  return (
    <div className="inline-flex rounded-xl border overflow-hidden">
      {items.map(([k, l]) => (
        <button
          key={k}
          onClick={() => setTab(k)}
          className={cls(
            "px-3 py-1 text-sm",
            tab === k ? "bg-blue-600 text-white" : "bg-white text-slate-600"
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function FooterBar({ current, onChange }) {
  const items = [
    ["home", "Günlük"],
    ["note", "Not"],
    ["report", "Rapor"],
  ];
  return (
    <div className="sticky bottom-0 mt-6 bg-white/80 backdrop-blur border-t">
      <div className="max-w-5xl mx-auto px-4 h-14 grid grid-cols-3 gap-3">
        {items.map(([k, label]) => (
          <button
            key={k}
            onClick={() => onChange(k)}
            className={cls(
              "m-2 rounded-xl font-medium",
              current === k ? "bg-blue-600 text-white" : "bg-slate-100"
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Check({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-slate-300 text-blue-600"
      />
      {label}
    </label>
  );
}

function StatCard({ label, value, tone = "blue" }) {
  const map = {
    blue: "bg-blue-500",
    emerald: "bg-emerald-500",
    rose: "bg-rose-500",
    amber: "bg-amber-500",
  };
  return (
    <div className="p-3 border rounded-2xl">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className={cls("mt-2 h-1.5 rounded-full", map[tone] || map.blue)} />
    </div>
  );
}

function Badge({ children, tone = "blue" }) {
  const map = {
    blue: "bg-blue-50 text-blue-700",
    emerald: "bg-emerald-50 text-emerald-700",
    violet: "bg-violet-50 text-violet-700",
    rose: "bg-rose-50 text-rose-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <span className={cls("px-2 py-0.5 rounded-lg text-xs border", map[tone])}>
      {children}
    </span>
  );
}
function IconWand({ className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 19l9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M15 3v3M15 9v3M12 6h3M18 6h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}