#!/bin/sh
set -e

echo "Blocking French IP ranges (FR)..."

# Download latest France IP ranges (IPv4)
curl -sSL https://www.ipdeny.com/ipblocks/data/countries/fr.zone -o /tmp/fr.zone

# Create ipset if not exists
ipset create france hash:net || true

# Add IPs to ipset
while read -r ip; do
  ipset add france "$ip" || true
done < /tmp/fr.zone

# Block incoming connections from France
iptables -I INPUT -m set --match-set france src -j DROP

echo "French IPs blocked."
