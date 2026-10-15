#!/bin/bash
cd "$(dirname "$0")"
echo "=== Pushing retail fixes (store filter + comma format + mobile layout + provision-stores) ==="
git push origin feature/retail-sales
echo "Done."
