#!/bin/bash
cd "$(dirname "$0")"
echo "=== Pushing daily-sales patch (comma formatting + mobile layout + provision-stores) ==="
git push origin feature/retail-sales
echo "Done — you can delete this file."
