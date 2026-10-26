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

    @property
    def headers(self) -> dict[str, str] | None:
        """Extra response headers (e.g. Retry-After); most errors have none."""
        return None

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


class GoneError(AppError):
    """The resource existed but is no longer usable (e.g. an expired invite)."""

    status_code = 410
    default_detail = "Kaynak artık geçerli değil"


class RateLimitedError(AppError):
    """Too many attempts. `retry_after` (whole seconds) becomes the Retry-After header."""

    status_code = 429
    default_detail = "Too many attempts. Try again later."

    def __init__(self, detail: str | None = None, retry_after: int | None = None) -> None:
        super().__init__(detail)
        self.retry_after = retry_after

    @property
    def headers(self) -> dict[str, str] | None:
        return None if self.retry_after is None else {"Retry-After": str(self.retry_after)}


class ServiceUnavailableError(AppError):
    """A dependency the request needs is temporarily unusable; the caller may retry later."""

    status_code = 503
    default_detail = "The service is temporarily unavailable. Try again in a moment."

    def __init__(self, detail: str | None = None, retry_after: int | None = None) -> None:
        super().__init__(detail)
        self.retry_after = retry_after

    @property
    def headers(self) -> dict[str, str] | None:
        return None if self.retry_after is None else {"Retry-After": str(self.retry_after)}


class PreconditionFailedError(AppError):
    """The caller acted on a version of the resource that has since changed."""

    status_code = 412
    default_detail = "The resource changed since you last looked at it."
