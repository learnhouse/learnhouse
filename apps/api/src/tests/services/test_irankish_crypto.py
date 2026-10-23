"""Unit tests for the IranKish digital-envelope crypto.

These lock down the two things that must be exactly right for the gateway to
accept our token request:
  1. the base-string formula for a plain purchase, and
  2. the AES-128-CBC/PKCS7 + SHA-256 + 48-byte-block + RSA assembly.

The base-string case uses the worked example published in the technical guide
(docs/irankish/IPG_TechnicalGuide.V11.pdf, section 10.1): terminal 02000001,
pass phrase AAFF124578127138, amount 1000 Rial.
"""

import hashlib

import pytest
from cryptography.hazmat.primitives import padding, serialization
from cryptography.hazmat.primitives.asymmetric import padding as asym_padding, rsa
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from src.services.payments.irankish.crypto import (
    EnvelopeError,
    build_base_string,
    make_authentication_envelope,
)


def test_base_string_matches_guide_example():
    # The guide's worked example resolves to this exact base string.
    assert (
        build_base_string("02000001", "AAFF124578127138", 1000)
        == "02000001AAFF12457812713800000000100000"
    )


def test_base_string_pads_amount_to_twelve_digits():
    bs = build_base_string("00000001", "AAFFAAFFAAFFAAFF", 50)
    # terminal(8) + passphrase(16) + amount padded to 12 + "00"
    assert bs == "00000001" + "AAFFAAFFAAFFAAFF" + "000000000050" + "00"
    assert len(bs) % 2 == 0  # always even -> decodable as hex


@pytest.mark.parametrize("bad_amount", [0, -5])
def test_base_string_rejects_non_positive_amount(bad_amount):
    with pytest.raises(EnvelopeError):
        build_base_string("02000001", "AAFF124578127138", bad_amount)


def test_base_string_rejects_overlong_amount():
    with pytest.raises(EnvelopeError):
        build_base_string("02000001", "AAFF124578127138", 10**12)


def _rsa_keypair():
    priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pub_pem = priv.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return priv, pub_pem


def test_envelope_is_reversible_and_well_formed():
    """With a known key/IV, decrypting the envelope reproduces the inputs.

    This mirrors what the gateway does on receipt: RSA-decrypt ``data`` to get
    back the AES key + hash, then confirm the hash matches the AES ciphertext of
    the base string encrypted under the IV we sent.
    """
    priv, pub_pem = _rsa_keypair()
    aes_key = bytes.fromhex("E29F6D7A52373DD4398B76EFA690055E")
    iv = bytes.fromhex("8F5C757DAFA895501B5F9E8F286C64CC")

    env = make_authentication_envelope(
        terminal_id="02000001",
        pass_phrase="AAFF124578127138",
        amount=1000,
        public_key_pem=pub_pem,
        _aes_key=aes_key,
        _iv=iv,
    )

    # iv is echoed verbatim as hex.
    assert env.iv == iv.hex().upper()

    # RSA-decrypt data -> 48 bytes: first 16 = AES key, last 32 = SHA-256 hash.
    sealed = priv.decrypt(bytes.fromhex(env.data), asym_padding.PKCS1v15())
    assert len(sealed) == 48
    assert sealed[:16] == aes_key

    # Recompute the AES ciphertext of the base string and hash it; must match.
    base = build_base_string("02000001", "AAFF124578127138", 1000)
    payload = bytes.fromhex(base)
    padder = padding.PKCS7(algorithms.AES.block_size).padder()
    padded = padder.update(payload) + padder.finalize()
    enc = Cipher(algorithms.AES(aes_key), modes.CBC(iv)).encryptor()
    ciphertext = enc.update(padded) + enc.finalize()
    assert sealed[16:] == hashlib.sha256(ciphertext).digest()


def test_envelope_generates_fresh_random_material_each_call():
    _, pub_pem = _rsa_keypair()
    e1 = make_authentication_envelope(
        terminal_id="02000001", pass_phrase="AAFF124578127138", amount=1000,
        public_key_pem=pub_pem,
    )
    e2 = make_authentication_envelope(
        terminal_id="02000001", pass_phrase="AAFF124578127138", amount=1000,
        public_key_pem=pub_pem,
    )
    # Random IV + RSA PKCS#1 v1.5 randomness => different envelopes.
    assert e1.iv != e2.iv
    assert e1.data != e2.data


def test_envelope_rejects_bad_public_key():
    with pytest.raises(EnvelopeError):
        make_authentication_envelope(
            terminal_id="02000001", pass_phrase="AAFF124578127138", amount=1000,
            public_key_pem="not a real key",
        )
