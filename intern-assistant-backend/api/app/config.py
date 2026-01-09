import os

# -------------------------------------------------------------------
# JWT ayarları
# -------------------------------------------------------------------
JWT_SECRET = os.getenv("JWT_SECRET", "super-secret-key")  # değiştirilmeli!
JWT_ALG = "HS256"
JWT_EXP_MINUTES = 60 * 12  # 12 saat

# -------------------------------------------------------------------
# HMAC ayarları (TC'den patient_id türetmek için)
# -------------------------------------------------------------------
HMAC_SECRET = os.getenv("HMAC_SECRET", b"intern-assistant-secret")

# -------------------------------------------------------------------
# Admin kullanıcı (ilk giriş için)
# -------------------------------------------------------------------
ADMIN_USER = os.getenv("ADMIN_USER", "admin")
ADMIN_PASS = os.getenv("ADMIN_PASS", "admin123")
