# Minimal mDNS responder for MicroPython
# Responds to A record queries for a .local hostname with the device's IP

# Imports
import socket
import struct
import time

# Initializations
MDNS_ADDR = "224.0.0.251" # mDNS multicast group
MDNS_PORT = 5353

# DNS names are length-prefixed labels: "onairsign.local" -> b"\x0aonairsign\x05local\x00"
def _encode_name(hostname):
    parts = hostname.split(".")
    result = b""
    for part in parts:
        result += bytes([len(part)]) + part.encode()
    return result + b"\x00"

def _build_response(query_id, encoded_name, ip_bytes):
    # Header: ID, flags (authoritative response), 1 question, 1 answer
    header = struct.pack("!6H", query_id, 0x8400, 1, 1, 0, 0)

    # Echo back the question section
    question = encoded_name + struct.pack("!2H", 1, 1) # Type A, Class IN

    # Answer: same name, Type A, Class IN, TTL 120s, 4-byte IP
    answer = encoded_name + struct.pack("!2HIH", 1, 1, 120, 4) + ip_bytes
    return header + question + answer

class MDNSResponder:
    def __init__(self, hostname, ip):
        self._hostname = hostname + ".local"
        self._encoded_name = _encode_name(self._hostname)
        self._ip_bytes = bytes(int(b) for b in ip.split("."))
        self._sock = None

    def stop(self):
        if self._sock:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None

    def start(self):
        self.stop()
        for attempt in range(5):
            try:
                self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                self._sock.setblocking(False)
                self._sock.bind(("0.0.0.0", MDNS_PORT))
                break
            except OSError:
                self._sock.close()
                self._sock = None
                if attempt < 4:
                    time.sleep(1)
                else:
                    raise

        # Join the mDNS multicast group to receive queries
        mcast = struct.pack("4s4s", socket.inet_aton(MDNS_ADDR), socket.inet_aton("0.0.0.0"))
        self._sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mcast)
        print(f"mDNS responder started: {self._hostname}")

    # Call from main loop. Non-blocking — returns immediately if no query pending.
    def process(self):
        if not self._sock:
            return
        try:
            data, addr = self._sock.recvfrom(256)
        except OSError:
            return # No data available

        if len(data) < 12: # Too short to be a valid DNS packet
            return

        # Ignore responses (QR=1) and packets with no questions
        flags, qdcount = struct.unpack_from("!2H", data, 2)
        if flags & 0x8000 or qdcount == 0:
            return

        # Extract the queried name (starts at byte 12, after the DNS header)
        qname_start = 12
        try:
            qname_end = data.index(b"\x00", qname_start) + 1
            qtype, qclass = struct.unpack_from("!2H", data, qname_end)
        except (ValueError, struct.error):
            return # Malformed packet, drop it
        qname = data[qname_start:qname_end]
        if qname.lower() != self._encoded_name:
            return # Not for us

        # Only respond to A record (1) or ANY (255) queries
        if qtype not in (1, 255):
            return

        # Send our IP as the answer back to the multicast group
        query_id = struct.unpack_from("!H", data, 0)[0]
        response = _build_response(query_id, self._encoded_name, self._ip_bytes)
        self._sock.sendto(response, (MDNS_ADDR, MDNS_PORT))