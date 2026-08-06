"""Uygulamaya özel hata sınıfları.

FastAPI'nin HTTPException'ını iş mantığı (service) katmanında doğrudan
kullanmak yerine bunları tercih ediyoruz:
  1. Service katmanı HTTP'den habersiz kalır (test etmesi kolaylaşır,
     ileride başka bir arayüzden de çağrılabilir).
  2. main.py'daki tek bir exception handler hepsini HTTP response'a çevirir.

Kullanım: `raise NotFoundError("Kullanıcı bulunamadı")`
"""


class AppError(Exception):
    """Tüm uygulama hatalarının base sınıfı."""

    status_code: int = 500
    default_detail: str = "Beklenmeyen bir hata oluştu"

    def __init__(self, detail: str | None = None) -> None:
        self.detail = detail or self.default_detail
        super().__init__(self.detail)


class NotFoundError(AppError):
    status_code = 404
    default_detail = "Kaynak bulunamadı"


class UnauthorizedError(AppError):
    """Kimlik doğrulama başarısız veya token geçersiz/eksik."""

    status_code = 401
    default_detail = "Kimlik doğrulama başarısız"


class ForbiddenError(AppError):
    """Kimlik doğrulandı ama bu işlem için yetki yok."""

    status_code = 403
    default_detail = "Bu işlem için yetkiniz yok"


class ConflictError(AppError):
    """Benzersizlik ihlali vb. (örn. email zaten kayıtlı)."""

    status_code = 409
    default_detail = "Kaynak zaten mevcut"


class ValidationAppError(AppError):
    """Pydantic'in yakalayamadığı, iş mantığına özel doğrulama hataları."""

    status_code = 422
    default_detail = "Geçersiz veri"