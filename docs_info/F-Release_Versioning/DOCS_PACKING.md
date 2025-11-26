DOCS_PACKING.md
1. Purpose

Defines how to generate the documentation bundle and hash evidence (HASHES.sha256.txt) used in releases and legal/IP proof.

2. Documents Included

The docs pack includes:

All Markdown docs under /docs (architecture, modules, ops, security, IP, timestamping...).

All DDL files critical to DB identity.

Select scripts important for reproducibility.

VERSION

SOURCE_TAG

The exact list is maintained in scripts/docs/pack-files.json or equivalent.

3. Hashing Process
3.1 Input Selection

Use a curated include-list, not auto-discovery, to avoid noise:

{
  "include": [
    "docs/ARCHITECTURE.md",
    "docs/DATABASE.md",
    "docs/DDL_ORDER.md",
    "docs/OPERATIONS.md",
    "src/core/db/ddl/00_schemas.sql",
    "src/core/db/ddl/01_extensions.sql",
    "src/core/db/ddl/06_str-aux.sql",
    ...
  ]
}
3.2 Hash Each File

Pseudo-command:

sha256sum file >> docs/HASHES.sha256.txt

Or Node/PowerShell script iterating through the list:

import { createHash } from 'crypto';
import { readFileSync } from 'fs';


function hashFile(path) {
  const data = readFileSync(path);
  return createHash('sha256').update(data).digest('hex');
}
3.3 Ordering

Alphabetical by path.

One hash per line.

Two-space separated: <hash> <path>.

3.4 Verification

Anyone can verify:

sha256sum --check docs/HASHES.sha256.txt
4. Building the Pack

Example PowerShell:

$files = Get-Content scripts/docs/pack-files.txt
$hashOut = "docs/HASHES.sha256.txt"
Remove-Item $hashOut -ErrorAction SilentlyContinue
foreach ($f in $files) {
  $hash = Get-FileHash $f -Algorithm SHA256
  "$($hash.Hash)  $f" | Add-Content $hashOut
}
5. Tag Integration

Once hashes are generated:

git add docs/HASHES.sha256.txt VERSION SOURCE_TAG
git commit -m "docs: pack v0.1.1"

Then tag the version:

git tag v0.1.1
git push origin v0.1.1
6. Storage & Archival

Store docs pack in offline drive.

Keep encrypted copy in long-term cloud.

Use this pack for INPI or other IP filings.