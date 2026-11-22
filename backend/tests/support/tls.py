"""Throw-away certificates for tests and the local staging stack. Never for anything real.

`make_authority()` and `issue()` build an in-memory CA and a server certificate signed by
it, so a test can run a real TLS server and prove that a client really verifies the chain
and the hostname: trusting the CA (SSL_CERT_FILE) accepts, an unknown CA or a wrong name
rejects. As a script it writes the files the local staging stack mounts:

    python -m tests.support.tls OUTDIR NAME [NAME ...]

(ca.crt, server.crt, server.key; every NAME, and 127.0.0.1, is valid for the server).
The CA key is discarded: nothing can issue more certificates under it later.
"""

import datetime
import ipaddress
import sys
from dataclasses import dataclass
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

_VALID_FOR = datetime.timedelta(days=2)


@dataclass(frozen=True)
class Authority:
    key: ec.EllipticCurvePrivateKey
    certificate: x509.Certificate

    @property
    def pem(self) -> bytes:
        return self.certificate.public_bytes(serialization.Encoding.PEM)


@dataclass(frozen=True)
class Issued:
    key_pem: bytes
    certificate_pem: bytes


def _name(common_name: str) -> x509.Name:
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)])


def make_authority() -> Authority:
    key = ec.generate_private_key(ec.SECP256R1())
    now = datetime.datetime.now(datetime.UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(_name("bodytrack test CA"))
        .issuer_name(_name("bodytrack test CA"))
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + _VALID_FOR)
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                key_cert_sign=True,
                crl_sign=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(key, hashes.SHA256())
    )
    return Authority(key, certificate)


def issue(authority: Authority, *names: str) -> Issued:
    key = ec.generate_private_key(ec.SECP256R1())
    now = datetime.datetime.now(datetime.UTC)
    alternatives: list[x509.GeneralName] = [x509.DNSName(name) for name in names]
    alternatives.append(x509.IPAddress(ipaddress.ip_address("127.0.0.1")))
    certificate = (
        x509.CertificateBuilder()
        .subject_name(_name(names[0]))
        .issuer_name(authority.certificate.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + _VALID_FOR)
        .add_extension(x509.SubjectAlternativeName(alternatives), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(authority.key.public_key()),
            critical=False,
        )
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .sign(authority.key, hashes.SHA256())
    )
    return Issued(
        key_pem=key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ),
        certificate_pem=certificate.public_bytes(serialization.Encoding.PEM),
    )


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    out = Path(argv[0])
    out.mkdir(parents=True, exist_ok=True)
    authority = make_authority()
    issued = issue(authority, *argv[1:])
    (out / "ca.crt").write_bytes(authority.pem)
    (out / "server.crt").write_bytes(issued.certificate_pem)
    (out / "server.key").write_bytes(issued.key_pem)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
