"""Decode the supplied StringTest.java big-endian ASCII metadata protocol."""
import math


def decode_ascii(value):
    value=float(value)
    if not math.isfinite(value) or value!=int(value) or not 0<value<=2**53:
        raise ValueError("Invalid encoded metadata integer")
    number=int(value)
    text=number.to_bytes((number.bit_length()+7)//8,"big").decode("ascii")
    if not text or not all(c.isalnum() or c in "_-" for c in text):
        raise ValueError("Invalid encoded metadata characters")
    return text


def metadata_field(number,suite):
    leaf=suite.rsplit(".",1)[-1]
    if leaf=="lotidTest": return {20:"lot_lower",21:"lot_upper"}.get(number)
    if leaf=="waferidTest" and number==25: return "wafer"
    return None
