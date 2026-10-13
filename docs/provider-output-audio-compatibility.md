# Bounded provider output audio compatibility

The full evaluation recorded a 92,844-character base64 output packet rejected by the previous 87,384-character guard. This confirms a length rejection; the original PCM packet is unavailable, so it does not prove every field was valid.

The Seeduplex adapter now accepts canonical, nonempty, even-length PCM up to 90 KiB per owned provider packet and emits ordered internal chunks no larger than 64 KiB. This leaves room for protocol fields within the existing 128 KiB socket limit. This bound is a local compatibility policy, not a supplier guarantee. Web playback, internal contracts, cancellation fences and input audio framing retain their limits. Oversized or malformed packets still fail rather than being truncated.

Synthetic tests concatenate output chunks byte-for-byte, validate runtime ownership and reject malformed, noncanonical, odd, oversized and cancelled output. Real-provider collection and audible Web acceptance remain separate checks. Historical 018 collection records are preserved.
