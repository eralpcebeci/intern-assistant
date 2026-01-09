# Intern Assistant 🩺  
**İntörn Doktor Vizit ve Gün Sonu Raporlama Sistemi**

Intern Assistant, Tıp Fakültesi **İntörn (Dönem 6) öğrencilerinin** günlük hasta vizitlerini pratik, düzenli ve güvenli şekilde kaydedebilmesi; **eğitici hekimlerin** ise gün sonu özetlerini hızlıca görebilmesi amacıyla geliştirilmiş bir web uygulamasıdır.

Bu proje, gerçek hastane işleyişini birebir kopyalamak yerine **eğitim sürecini destekleyen**, hafif ve kullanıcı dostu bir yardımcı sistem olarak tasarlanmıştır.

---

## 🎯 Amaç
- İntörnlerin günlük vizitlerini **unutmadan, dağılmadan** kayıt altına almasını sağlamak  
- Eğitici hekimlerin **gün sonu hasta ve öğrenci özetlerini** hızlıca inceleyebilmesi  
- Kağıt, WhatsApp notları veya dağınık defter kullanımını azaltmak  

---

## 👥 Kullanıcı Rollerı

### 👩‍⚕️ İntörn
- Hasta TC’den **anonim hasta kodu** oluşturur  
- Günlük vizit ekler, düzenler ve silebilir  
- Sadece **kendi girdiği vizitleri** görür  
- Vizitlerde:
  - Bölüm
  - Klinik not
  - İlaç / tetkik / konsültasyon
  - Kritik hasta işareti
  alanlarını doldurur  

### 👨‍🏫 Eğitici Hekim
- Günlük raporları **okuma amaçlı** görüntüler  
- Bölüm, tarih ve öğrenci bazlı filtreleme yapabilir  
- Vizitlere **müdahale edemez** (silme/düzenleme yok)  
- Gün sonu özetini **PDF olarak indirebilir**

---

## 🧩 Temel Özellikler

- 🔐 JWT tabanlı kimlik doğrulama  
- 🧾 TC üzerinden **hashlenmiş hasta kodu** (kişisel veri saklanmaz)  
- 🗂 Gün / bölüm / öğrenci bazlı filtreleme  
- ✏️ Vizit ekleme – düzenleme – silme (sadece yazan öğrenci)  
- ⚠️ Kritik hasta işaretleme  
- 📊 Gün sonu istatistikleri  
- 📄 **AI destekli gün sonu PDF raporu** (hocaya özel)  
- 🇹🇷 Türkçe karakter uyumlu PDF çıktısı  

---

## 🤖 AI Kullanımı

Uygulamada yapay zeka:
- Tanı koymak veya karar vermek için **kullanılmaz**
- Sadece **gün sonu vizit özetlerini okunabilir rapora dönüştürmek** amacıyla kullanılır  

Amaç, eğitici hekimin uzun vizit metinlerini tek tek okumadan:
- Kaç hasta bakıldı
- Kaç kritik vaka vardı
- Hangi öğrenciler ne kadar aktifti  

gibi bilgileri **tek sayfada** görmesini sağlamaktır.

---

## 🛠️ Teknoloji Stack

### Backend
- Python
- FastAPI
- SQLAlchemy
- SQLite
- JWT Authentication
- ReportLab (PDF üretimi)

### Frontend
- React
- TailwindCSS
- Fetch API

---

## ▶️ Çalıştırma

### Backend
```bash
cd intern-assistant-backend
python -m venv venv
venv\Scripts\activate   # Windows
pip install -r requirements.txt
uvicorn api.main:app --reload





frontend

cd intern-assistant-ui
npm install
npm start
