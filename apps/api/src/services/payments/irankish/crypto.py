"""
Digital-envelope construction for the IranKish (Shaparak) IPG token service.

The ``api/v3/tokenization/make`` endpoint authenticates the merchant with a
"digital envelope" rather than a plain API key: a symmetric (AES-128-CBC/PKCS7)
layer protecting the payload, whose AES key and a SHA-256 integrity hash are
themselves sealed with the gateway's RSA public key. This module builds exactly
the structure the gateway expects, following section 10.1 of the technical
guide (docs/irankish/IPG_TechnicalGuide.V11.pdf).

Steps (for a normal, non-bill, non-multiplex purchase):

  1. Build a base string:
         terminalId + passPhrase + amount(left-padded to 12 digits) + "00"
     and treat it as a HEX string decoded into a byte array.
  2. Generate a random 128-bit AES key and 128-bit IV.
  3. AES-CBC/PKCS7-encrypt the byte array with that key + IV.
  4. SHA-256-hash the AES ciphertext.
  5. Build a 48-byte array: bytes [0:16] = the AES key, bytes [16:48] = the hash.
  6. RSA-encrypt that 48-byte array with the gateway's public key.
  7. Emit ``data`` = hex(RSA ciphertext), ``iv`` = hex(IV).

We only implement the plain-purchase base string (what a course sale needs); the
multiplex / bill variants are intentionally out of scope.

Primitives come from the already-vendored ``cryptography`` package, so no new
dependency is introduced.
"""

import hashlib
import os
from dataclasses import dataclass

from cryptography.hazmat.primitives import padding, serialization
from cryptography.hazmat.primitives.asymmetric import padding as asym_padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.serialization import load_pem_public_key

AES_KEY_SIZE = 16  # 128-bit key, as the guide mandates.
AES_IV_SIZE = 16  # 128-bit IV.


class EnvelopeError(ValueError):
    """Raised when the digital envelope cannot be built (e.g. a malformed
    public key or an invalid amount)."""


@dataclass(frozen=True)
class AuthenticationEnvelope:
    """The ``authenticationEnvelope`` object sent to the token endpoint.

    ``data`` is the RSA-encrypted (AES key + SHA-256 hash) as an upper-case hex
    string; ``iv`` is the AES initialisation vector as an upper-case hex string.
    """

    data: str
    iv: str

    def to_request(self) -> dict:
        return {"data": self.data, "iv": self.iv}


def build_base_string(terminal_id: str, pass_phrase: str, amount: int) -> str:
    """Build the plain-purchase base string the envelope protects.

    Format (verified against the guide's worked example): the terminal id,
    then the 16-char pass phrase, then the amount left-padded with zeros to 12
    digits, then a trailing ``"00"`` process code for a purchase transaction.
    """
    if amount <= 0:
        raise EnvelopeError("amount must be a positive integer (in Rial).")
    if len(str(amount)) > 12:
        raise EnvelopeError("amount exceeds the 12-digit gateway limit.")
    return f"{terminal_id}{pass_phrase}{str(amount).zfill(12)}00"


def _hex_string_to_bytes(hex_str: str) -> bytes:
    """Decode the base string as HEX into a byte array (guide step 2).

    The base string is composed entirely of hex digits (0-9, A-F) because the
    terminal id, pass phrase and zero-padded amount are themselves hex-safe, so
    ``bytes.fromhex`` is exactly the "treat the string as a HEX array" step.
    """
    try:
        return bytes.fromhex(hex_str)
    except ValueError as exc:  # pragma: no cover - defensive; pass phrase shape
        raise EnvelopeError(
            "base string is not valid hex; the pass phrase must be hex characters."
        ) from exc


def _aes_encrypt(data: bytes, key: bytes, iv: bytes) -> bytes:
    """AES-128-CBC with PKCS7 padding (guide: Cipher CBC, Padding PKCS7, 128-bit)."""
    padder = padding.PKCS7(algorithms.AES.block_size).padder()
    padded = padder.update(data) + padder.finalize()
    encryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    return encryptor.update(padded) + encryptor.finalize()


def _rsa_encrypt(data: bytes, public_key_pem: str) -> bytes:
    """RSA-encrypt the 48-byte (key + hash) block with the gateway public key.

    The guide uses the classic .NET RSA default, which is PKCS#1 v1.5 for the
    IKC gateway (not OAEP). The 48-byte payload fits comfortably inside a
    1024/2048-bit modulus.
    """
    try:
        key = load_pem_public_key(public_key_pem.encode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - surface any PEM/key problem uniformly
        raise EnvelopeError(f"invalid IranKish RSA public key: {exc}") from exc
    try:
        return key.encrypt(data, asym_padding.PKCS1v15())  # type: ignore[union-attr]
    except AttributeError as exc:
        raise EnvelopeError(
            "configured IranKish public key is not an RSA key."
        ) from exc


def make_authentication_envelope(
    *,
    terminal_id: str,
    pass_phrase: str,
    amount: int,
    public_key_pem: str,
    _aes_key: bytes | None = None,
    _iv: bytes | None = None,
) -> AuthenticationEnvelope:
    """Build the full ``authenticationEnvelope`` for a purchase of ``amount`` Rial.

    ``_aes_key`` and ``_iv`` are injection points for deterministic testing with
    the guide's published vectors; production callers never pass them, so a fresh
    random key/IV is generated per request (as required - the token is single
    use and short-lived).
    """
    base_string = build_base_string(terminal_id, pass_phrase, amount)
    payload = _hex_string_to_bytes(base_string)

    aes_key = _aes_key if _aes_key is not None else os.urandom(AES_KEY_SIZE)
    iv = _iv if _iv is not None else os.urandom(AES_IV_SIZE)
    if len(aes_key) != AES_KEY_SIZE:
        raise EnvelopeError("AES key must be 16 bytes (128-bit).")
    if len(iv) != AES_IV_SIZE:
        raise EnvelopeError("AES IV must be 16 bytes (128-bit).")

    ciphertext = _aes_encrypt(payload, aes_key, iv)
    digest = hashlib.sha256(ciphertext).digest()

    # 48-byte block: first 16 bytes the AES key, last 32 bytes the SHA-256 hash.
    sealed_block = aes_key + digest
    rsa_ciphertext = _rsa_encrypt(sealed_block, public_key_pem)

    return AuthenticationEnvelope(
        data=rsa_ciphertext.hex().upper(),
        iv=iv.hex().upper(),
    )


__all__ = [
    "AuthenticationEnvelope",
    "EnvelopeError",
    "build_base_string",
    "make_authentication_envelope",
]
