from typing import Dict, List, Optional
from datetime import datetime
from pydantic import BaseModel, Field, validator


# ========== Auth ==========
class TokenResponse(BaseModel):
    access_token: str
    username: str
    display_name: str
    role: str

    class Config:
        orm_mode = True


# ========== Patient ID türetme ==========
class DeriveRequest(BaseModel):
    tc: str = Field(..., description="11 haneli T.C. kimlik numarası (sadece rakam)")

    @validator("tc")
    def _tc_11_digits(cls, v: str) -> str:
        vv = "".join(ch for ch in (v or "") if ch.isdigit())
        if len(vv) != 11:
            raise ValueError("TC tam 11 rakam olmalı")
        return vv


class DeriveResponse(BaseModel):
    patient_id: str

    class Config:
        orm_mode = True


# ========== Patients ==========
class PatientCreate(BaseModel):
    patient_id: str
    label: Optional[str] = ""


class PatientOut(BaseModel):
    patient_id: str
    label: str = ""

    class Config:
        orm_mode = True


# ========== Visits ==========
class VisitCreate(BaseModel):
    patient_id: str
    text: str = Field(..., min_length=1)
    # işlem işaretleri
    ops_drug: bool = False
    ops_test: bool = False
    ops_consult: bool = False
    ops_critical: bool = False
    # bölüm
    department: Optional[str] = "GENEL"


class VisitOut(BaseModel):
    id: int
    patient_id: str
    author_id: int
    text: Optional[str] = ""
    department: Optional[str] = "GENEL"
    ts: datetime
    edited_at: Optional[datetime] = None

    # işlem işaretleri
    ops_drug: bool = False
    ops_test: bool = False
    ops_consult: bool = False
    ops_critical: bool = False

    class Config:
        orm_mode = True


# ========== Reports ==========
class ReportDaily(BaseModel):
    patients_seen: int
    totals: Dict[str, int]  # {"critical": int, "drugs": int, "tests": int, "consults": int}
    by_author: Dict[str, int]  # {"E. Sude": 5, ...}  (vizit sayısı)
    by_author_detail: Dict[str, Dict[str, int]]  # {"E. Sude": {"patients": 3, "visits": 5, "critical": 1}}
    lines: List[str]


# ========== Authors (Supervisor için) ==========
class AuthorOut(BaseModel):
    username: str
    display_name: str
    counts: Dict[str, int]  # {"patients": X, "visits": Y, "critical": Z}

    class Config:
        orm_mode = True
