# Original Impressions — Joe Trimmeliti

Portfolio site for King City, Ontario painter Joe Trimmeliti. Static site on GitHub Pages; all paintings and events live in `data/art.json`.

- **Inquiry form** posts to FormSubmit, which emails `info@joetrimmeliti.com`. The very first submission sends Joe an activation email he must click once.
- **Admin** is at `/admin/` (not linked, `noindex`, blocked in `robots.txt`). It edits `data/art.json` and uploads photos by committing to this repo through the GitHub API; Pages redeploys in about a minute.

## One-time admin setup

1. GitHub → Settings → Developer settings → Fine-grained tokens → **Generate new token**.
   Repository access: *Only select repositories* → this repo. Permissions: **Contents: Read and write**. Choose the longest expiry.
2. Open `/admin/`, paste the token, choose Joe's password, press **Encrypt & save**.
   This commits `admin/vault.json`: the token encrypted with AES-GCM under a PBKDF2 (600k) key from the password. The plain token is never stored.
3. When the token expires, delete `admin/vault.json` and repeat.

## Custom domain

Add a `CNAME` file containing `joetrimmeliti.com`, point the domain's DNS at GitHub Pages, and the canonical URLs, sitemap and Open Graph tags are already correct.
