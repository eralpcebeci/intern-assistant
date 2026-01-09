from fastapi import FastAPI, Depends, HTTPException, status, Query, Path
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, case
from datetime import date, datetime, timedelta
from io import BytesIO
import hmac, hashlib, base64
from typing import Optional, Dict, List, Tuple

from .db import Base, engine, get_db
from .models import User, Patient, Visit
from .schemas import (
    TokenResponse, DeriveRequest, DeriveResponse,
    PatientCreate, PatientOut, VisitCreate, VisitOut,
    ReportDaily, AuthorOut
)
from .security import create_access_token, verify_password, hash_password
from .config import HMAC_SECRET, ADMIN_USER, ADMIN_PASS


# ================== App & CORS ==================
app = FastAPI(title="Intern Assistant API", version="0.3.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")
Base.metadata.create_all(bind=engine)

# ---- PDF motoru (opsiyonel): reportlab
try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib import colors
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    HAVE_REPORTLAB = True
except Exception:
    HAVE_REPORTLAB = False


# ---- PDF font ayarı (Windows Arial) ----
def _register_pdf_fonts() -> bool:
    if not HAVE_REPORTLAB:
        return False
    try:
        # Windows sistem fontları
        arial_regular = r"C:\Windows\Fonts\arial.ttf"
        arial_bold    = r"C:\Windows\Fonts\arialbd.ttf"
        pdfmetrics.registerFont(TTFont("Arial", arial_regular))
        pdfmetrics.registerFont(TTFont("Arial-Bold", arial_bold))
        return True
    except Exception as e:
        print("PDF font kaydı yapılamadı, Helvetica'ya düşülecek:", e)
        return False

_PDF_FONTS_OK = _register_pdf_fonts()


# ================== Helpers ==================
def _seed_admin(db: Session):
    """İlk kullanıcıları ve hocayı ekle (tek seferlik)."""
    if not db.query(User).filter(User.username == ADMIN_USER).first():
        db.add(
            User(
                username=ADMIN_USER,
                display_name="Admin",
                password_hash=hash_password(ADMIN_PASS),
                role="admin",
            )
        )
    demo = [
        ("e.sude", "E. Sude", "intern"),
        ("a.yilmaz", "A. Yılmaz", "intern"),
        ("m.demir", "M. Demir", "intern"),
        ("burcin.hoca", "B. Hoca", "supervisor"),
    ]
    for u, n, r in demo:
        if not db.query(User).filter(User.username == u).first():
            db.add(
                User(
                    username=u,
                    display_name=n,
                    password_hash=hash_password("1234"),
                    role=r,
                )
            )
    db.commit()


@app.on_event("startup")
def on_start():
    db = next(get_db())
    _seed_admin(db)


def get_current_user(
    db: Session = Depends(get_db),
    token: str = Depends(oauth2_scheme),
) -> User:
    """JWT'den kullanıcıyı çöz."""
    from jose import jwt, JWTError
    from .config import JWT_SECRET, JWT_ALG

    cred_exc = HTTPException(status_code=401, detail="Invalid credentials")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        username: str = payload.get("sub")
        if username is None:
            raise cred_exc
    except JWTError:
        raise cred_exc
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise cred_exc
    return user


def ist_day_range(day_str: Optional[str]) -> Tuple[datetime, datetime]:
    """
    Seçilen gün için İstanbul (UTC+3) yerel gün aralığını [00:00, 24:00) döndürür.
    Naive datetime kullanıyoruz ve create/update'te ts'yi UTC+3 yazıyoruz.
    """
    if day_str:
        d = date.fromisoformat(day_str)
    else:
        d = date.today()
    start = datetime(d.year, d.month, d.day, 0, 0, 0)
    end = start + timedelta(days=1)
    return start, end


# ================== Auth ==================
@app.post("/auth/login", response_model=TokenResponse)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.username == form_data.username.lower()).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(400, "Kullanıcı adı veya şifre hatalı")
    token = create_access_token({"sub": user.username, "role": user.role})
    return TokenResponse(
        access_token=token,
        display_name=user.display_name,
        username=user.username,
        role=user.role,
    )


# ================== Patient ID türetme ==================
@app.post("/patients/derive", response_model=DeriveResponse)
def derive_id(inp: DeriveRequest, current: User = Depends(get_current_user)):
    mac = hmac.new(HMAC_SECRET, inp.tc.encode(), hashlib.sha256).digest()
    short = base64.urlsafe_b64encode(mac).decode()[:8].lower()
    return DeriveResponse(patient_id=f"PX-{short}")


# ================== Patients ==================
@app.post("/patients", response_model=PatientOut)
def create_or_get_patient(
    p: PatientCreate,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    existing = db.query(Patient).filter(Patient.patient_id == p.patient_id).first()
    if existing:
        return PatientOut(patient_id=existing.patient_id, label=existing.label)
    obj = Patient(patient_id=p.patient_id, label=p.label or "", created_by=current.id)
    db.add(obj)
    db.commit()
    return PatientOut(patient_id=obj.patient_id, label=obj.label)


@app.get("/patients/list")
def list_patients(
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    department: str = "ALL",
    day: Optional[str] = None,
):
    """
    Seçili gün + bölüme göre hasta listesi (her hasta için bugün kaç vizit ve son vizit zamanı).
    Intern -> sadece kendi vizitlerinden oluşan hastalar
    Supervisor/Admin -> tüm öğrenciler
    """
    start, end = ist_day_range(day)
    q = (
        db.query(
            Visit.patient_id.label("pid"),
            func.count(Visit.id).label("cnt"),
            func.max(Visit.ts).label("last_ts"),
        )
        .filter(and_(Visit.ts >= start, Visit.ts < end))
    )
    if department != "ALL":
        q = q.filter(Visit.department == department.upper())
    if current.role == "intern":
        q = q.filter(Visit.author_id == current.id)
    q = q.group_by(Visit.patient_id).order_by(func.max(Visit.ts).desc())

    items = []
    for row in q.all():
        p = db.query(Patient).filter(Patient.patient_id == row.pid).first()
        items.append(
            {
                "patient_id": row.pid,
                "label": p.label if p else "",
                "count_today": int(row.cnt),
                "last_visit_ts": row.last_ts.isoformat() if row.last_ts else None,
            }
        )
    return {"items": items}


@app.get("/patients/{patient_id}/visits")
def patient_visits(
    patient_id: str = Path(...),
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    day: Optional[str] = None,
):
    """
    Seçili hasta için sadece SEÇİLİ GÜN vizitleri (departmandan bağımsız).
    Intern -> sadece kendi vizitlerini görür.
    """
    start, end = ist_day_range(day)
    q = db.query(Visit).filter(
        Visit.patient_id == patient_id, and_(Visit.ts >= start, Visit.ts < end)
    )
    if current.role == "intern":
        q = q.filter(Visit.author_id == current.id)

    rows = q.order_by(Visit.ts.asc()).all()
    users = {u.id: u.display_name for u in db.query(User).all()}
    out = []
    for r in rows:
        out.append(
            {
                "id": r.id,
                "ts": r.ts.isoformat(),
                "author": users.get(r.author_id, "?"),
                "text": r.text,
                "department": r.department,
                "edited_at": r.edited_at.isoformat() if r.edited_at else None,
                "ops": {
                    "drug": bool(r.ops_drug),
                    "test": bool(r.ops_test),
                    "consult": bool(r.ops_consult),
                    "critical": bool(r.ops_critical),
                },
            }
        )
    p = db.query(Patient).filter(Patient.patient_id == patient_id).first()
    return {"patient_id": patient_id, "label": (p.label if p else ""), "visits": out}


# ================== Visits (CRUD) ==================
@app.post("/visits", response_model=VisitOut)
def create_visit(
    v: VisitCreate,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not db.query(Patient).filter(Patient.patient_id == v.patient_id).first():
        raise HTTPException(404, "Patient not found")

    # İstanbul saatine göre (UTC+3) kaydet
    ist_now = datetime.utcnow() + timedelta(hours=3)
    rec = Visit(
        patient_id=v.patient_id,
        author_id=current.id,
        text=v.text,
        ops_drug=v.ops_drug,
        ops_test=v.ops_test,
        ops_consult=v.ops_consult,
        ops_critical=v.ops_critical,
        department=(v.department or "GENEL").upper(),
        ts=ist_now,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


@app.put("/visits/{visit_id}")
def update_visit(
    visit_id: int,
    patch: Dict,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rec = db.query(Visit).filter(Visit.id == visit_id).first()
    if not rec:
        raise HTTPException(404, "Visit not found")
    # Sadece yazan kişi düzenleyebilir
    if rec.author_id != current.id:
        raise HTTPException(403, "Sadece kendi vizitinizi düzenleyebilirsiniz")

    text = patch.get("text")
    if text is not None:
        rec.text = text
    for k, attr in [
        ("ops_drug", "ops_drug"),
        ("ops_test", "ops_test"),
        ("ops_consult", "ops_consult"),
        ("ops_critical", "ops_critical"),
    ]:
        if k in patch:
            setattr(rec, attr, bool(patch[k]))
    rec.edited_at = datetime.utcnow() + timedelta(hours=3)
    db.commit()
    return {"ok": True}


@app.delete("/visits/{visit_id}")
def delete_visit(
    visit_id: int,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rec = db.query(Visit).filter(Visit.id == visit_id).first()
    if not rec:
        raise HTTPException(404, "Visit not found")
    if rec.author_id != current.id:
        raise HTTPException(403, "Sadece kendi vizitinizi silebilirsiniz")
    db.delete(rec)
    db.commit()
    return {"ok": True}


# ================== Reports & Feeds ==================
@app.get("/reports/daily", response_model=ReportDaily)
def report_daily(
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    department: str = "ALL",
    day: Optional[str] = None,
    author: Optional[str] = None,
):
    """
    Günlük özet: toplam kritik, ilaç, tetkik, konsültasyon ve
    öğrenci bazlı (patients/visits/critical) detaylar.
    Intern -> sadece kendi verisi; Hoca/Admin -> hepsi (isteğe bağlı author filtresi).
    """
    start, end = ist_day_range(day)
    q = db.query(Visit).filter(and_(Visit.ts >= start, Visit.ts < end))
    if department != "ALL":
        q = q.filter(Visit.department == department.upper())

    if current.role == "intern":
        q = q.filter(Visit.author_id == current.id)
    else:
        if author:
            # author: önce username, yoksa display_name
            u = db.query(User).filter(User.username == author).first()
            if not u:
                u = db.query(User).filter(User.display_name == author).first()
            if u:
                q = q.filter(Visit.author_id == u.id)

    rows = q.all()
    patients_seen = len(set(r.patient_id for r in rows))
    totals = {"critical": 0, "drugs": 0, "tests": 0, "consults": 0}
    by_author: Dict[str, int] = {}
    by_author_detail: Dict[str, Dict[str, int]] = {}
    users = {u.id: u.display_name for u in db.query(User).all()}

    for r in rows:
        if r.ops_critical:
            totals["critical"] += 1
        if r.ops_drug:
            totals["drugs"] += 1
        if r.ops_test:
            totals["tests"] += 1
        if r.ops_consult:
            totals["consults"] += 1
        nm = users.get(r.author_id, "Bilinmiyor")
        by_author[nm] = by_author.get(nm, 0) + 1

    # Öğrenci detayları
    author_ids = list(set([r.author_id for r in rows]))
    for aid in author_ids:
        nm = users.get(aid, "Bilinmiyor")
        arr = [r for r in rows if r.author_id == aid]
        by_author_detail[nm] = {
            "patients": len(set(x.patient_id for x in arr)),
            "visits": len(arr),
            "critical": sum(1 for x in arr if x.ops_critical),
        }

    lines = []
    if totals["critical"]:
        lines.append(f"{totals['critical']} kritik vaka")
    if totals["tests"]:
        lines.append(f"{totals['tests']} tetkik")
    if totals["drugs"]:
        lines.append(f"{totals['drugs']} ilaç")
    if not lines:
        lines.append("Önemli bulgu yok.")

    return ReportDaily(
        patients_seen=patients_seen,
        totals=totals,
        by_author=by_author,
        by_author_detail=by_author_detail,
        lines=lines,
    )


@app.get("/visits/by_department")
def by_department(
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    department: str = "ALL",
    day: Optional[str] = None,
    author: Optional[str] = None,
    limit: int = 200,
):
    """
    Bölüm akışı: seçili gün + bölüm için vizitler (zaman ters sıralı).
    Intern -> sadece kendi kayıtları; Hoca/Admin -> hepsi (isteğe bağlı author filtresi).
    """
    start, end = ist_day_range(day)
    q = db.query(Visit).filter(and_(Visit.ts >= start, Visit.ts < end))
    if department != "ALL":
        q = q.filter(Visit.department == department.upper())

    if current.role == "intern":
        q = q.filter(Visit.author_id == current.id)
    else:
        if author:
            u = db.query(User).filter(User.username == author).first()
            if not u:
                u = db.query(User).filter(User.display_name == author).first()
            if u:
                q = q.filter(Visit.author_id == u.id)

    q = q.order_by(Visit.ts.desc()).limit(limit)
    users = {u.id: u.display_name for u in db.query(User).all()}
    out: Dict[str, List[Dict]] = {}
    for r in q.all():
        who = users.get(r.author_id, "Bilinmiyor")
        out.setdefault(who, []).append(
            {
                "id": r.id,
                "patient_id": r.patient_id,
                "ts": r.ts.isoformat(),
                "text": r.text,
                "department": r.department,
                "edited_at": r.edited_at.isoformat() if r.edited_at else None,
                "ops": {
                    "drug": bool(r.ops_drug),
                    "test": bool(r.ops_test),
                    "consult": bool(r.ops_consult),
                    "critical": bool(r.ops_critical),
                },
            }
        )
    return {"by_author": out}


# ================== PDF Export ==================
def _build_pdf_bytes(
    title: str,
    overview_lines: List[str],
    perf_rows: List[tuple],
    feed_rows: List[tuple],
) -> BytesIO:
    if not HAVE_REPORTLAB:
        raise HTTPException(500, "PDF motoru yok: pip install reportlab")

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=36, rightMargin=36, topMargin=36, bottomMargin=36
    )

    styles = getSampleStyleSheet()
    # Arial kullan (yoksa Helvetica)
    styles["Normal"].fontName = "Arial" if _PDF_FONTS_OK else "Helvetica"
    styles["Normal"].fontSize = 10
    if "Title" in styles:
        styles["Title"].fontName = "Arial-Bold" if _PDF_FONTS_OK else "Helvetica-Bold"
        styles["Title"].fontSize = 16
        styles["Title"].leading = 20
    else:
        styles.add(ParagraphStyle(
            name="Title",
            fontName="Arial-Bold" if _PDF_FONTS_OK else "Helvetica-Bold",
            fontSize=16, leading=20, spaceAfter=8,
        ))

    story = []
    story.append(Paragraph(title, styles["Title"]))
    story.append(Spacer(1, 10))

    story.append(Paragraph("Özet", styles["Normal"]))
    if overview_lines:
        for l in overview_lines:
            story.append(Paragraph(f"• {l}", styles["Normal"]))
    else:
        story.append(Paragraph("Kayıt yok.", styles["Normal"]))
    story.append(Spacer(1, 12))

    if perf_rows:
        story.append(Paragraph("Öğrenci Özeti (Bugün)", styles["Normal"]))
        data = [("Öğrenci", "Hasta", "Vizit", "Kritik")] + perf_rows
        tbl = Table(data, hAlign="LEFT")
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
            ("ALIGN", (1, 1), (-1, -1), "CENTER"),
        ]))
        story.append(tbl)
        story.append(Spacer(1, 12))

    if feed_rows:
        story.append(Paragraph("Bölüm Akışı (kısa liste)", styles["Normal"]))
        for ts, pid, who, txt in feed_rows[:50]:
            # Inline font adı KULLANMA: Arial italik/bold eşleşmesi sorun çıkarabiliyor
            story.append(Paragraph(
                f"<b>{ts}</b> — {who} — <b>{pid}</b><br/>{txt}",
                styles["Normal"]))
            story.append(Spacer(1, 4))

    doc.build(story)
    buf.seek(0)
    return buf


@app.get("/reports/daily_pdf")
def report_daily_pdf(
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    department: str = "ALL",
    day: Optional[str] = None,
    author: Optional[str] = None,
):
    """
    Seçilen gün/bölüm için PDF indirir.
    - intern: sadece kendi kayıtlarını indirebilir (author zorla kendi display_name)
    - supervisor/admin: herkes için indirebilir; author parametresi ile filtreleyebilir
      (author hem username hem display_name olarak denenir).
    """
    if not HAVE_REPORTLAB:
        raise HTTPException(500, "PDF motoru yok: pip install reportlab")

    start, end = ist_day_range(day)
    if current.role == "intern":
        author = current.display_name

    q = db.query(Visit).filter(and_(Visit.ts >= start, Visit.ts < end))
    if department != "ALL":
        q = q.filter(Visit.department == department.upper())
    if author:
        u = db.query(User).filter(User.username == author).first()
        if not u:
            u = db.query(User).filter(User.display_name == author).first()
        if u:
            q = q.filter(Visit.author_id == u.id)
        else:
            q = q.filter(Visit.id == -1)  # boş

    rows = q.order_by(Visit.ts.asc()).all()
    users = {u.id: u.display_name for u in db.query(User).all()}

    # sayılar ve kısa özet
    totals = {
        "critical": sum(1 for r in rows if r.ops_critical),
        "drugs":   sum(1 for r in rows if r.ops_drug),
        "tests":   sum(1 for r in rows if r.ops_test),
        "consults":sum(1 for r in rows if r.ops_consult),
    }
    lines = []
    if totals["critical"]:
        lines.append(f"{totals['critical']} kritik kayıt")
    if totals["tests"]:
        lines.append(f"{totals['tests']} tetkik")
    if totals["drugs"]:
        lines.append(f"{totals['drugs']} ilaç")
    if not lines:
        lines.append("Önemli bulgu kaydı yok.")

    # öğrenci özeti
    perf_map: Dict[str, Dict] = {}
    for r in rows:
        nm = users.get(r.author_id, "Bilinmiyor")
        d = perf_map.setdefault(nm, {"patients": set(), "visits": 0, "critical": 0})
        d["patients"].add(r.patient_id)
        d["visits"] += 1
        if r.ops_critical:
            d["critical"] += 1
    perf_rows = [(n, len(v["patients"]), v["visits"], v["critical"]) for n, v in sorted(perf_map.items())]

    # akış satırları (ts, pid, who, text)
    feed_rows = []
    for r in rows:
        feed_rows.append((
            (r.ts).strftime("%H:%M"),
            r.patient_id,
            users.get(r.author_id, "?"),
            (r.text or "").replace("\n", " ")[:160],
        ))

    # başlık ve PDF
    day_text = (start.date().isoformat())
    title = f"Gün Sonu Özeti — {day_text} — Bölüm: {department}" + (f" — {author}" if author else "")
    pdf = _build_pdf_bytes(title, lines, perf_rows, feed_rows)

    safe_author = f"_{author.replace(' ', '_')}" if author else ""
    filename = f"gunsonu_{department}_{day_text}{safe_author}.pdf"
    return StreamingResponse(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/ai/rollup.pdf")
def rollup_pdf_alias(
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    department: str = "ALL",
    day: Optional[str] = None,
):
    return report_daily_pdf(current=current, db=db, department=department, day=day)


@app.get("/")
def health():
    return {"ok": True, "ts": datetime.utcnow().isoformat()}
