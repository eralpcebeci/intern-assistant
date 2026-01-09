from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship
from .db import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    display_name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="intern")  # intern, supervisor, admin

    visits = relationship("Visit", back_populates="author")


class Patient(Base):
    __tablename__ = "patients"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(String, unique=True, index=True, nullable=False)  # hashed TC
    label = Column(String, default="")
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    visits = relationship("Visit", back_populates="patient")


class Visit(Base):
    __tablename__ = "visits"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(String, ForeignKey("patients.patient_id"))
    author_id = Column(Integer, ForeignKey("users.id"))

    text = Column(String, default="")
    department = Column(String, default="GENEL")

    ops_drug = Column(Boolean, default=False)
    ops_test = Column(Boolean, default=False)
    ops_consult = Column(Boolean, default=False)
    ops_critical = Column(Boolean, default=False)

    ts = Column(DateTime(timezone=True), server_default=func.now())
    edited_at = Column(DateTime(timezone=True), nullable=True)

    author = relationship("User", back_populates="visits")
    patient = relationship("Patient", back_populates="visits")
