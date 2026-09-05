# Workout Generator: JS edition

The code in this repo deploys a serverless React website into AWS S3.

## Backups and device transfers

In the installed app, Settings provides **Export backup** and **Restore backup**
for a complete JSON backup of profiles, routines, workout history, and templates.
Restore previews additions and merges before saving. Older transfer files can
also be opened through Restore backup.

To transfer without files, connect both devices to the same Wi-Fi. Choose
**Send full backup** or **Send one routine** on the source, and **Receive with QR**
on the destination. Scan the source's pairing code(s) inside the receiving app,
then scan the receiver's reply code(s) inside the sending app. Confirm **Send data**
and review the import on the destination. The source keeps its data.
When more than one QR code is needed, the display cycles automatically; hold the
camera steady until the scan completes.

Pairing uses compressed, paged QR codes to exchange complete WebRTC descriptions.
There is no signaling service, STUN server, TURN relay, account, or cloud storage.
The reliable, ordered data channel carries the existing encrypted transfer
envelope in bounded chunks, with flow control and a receipt acknowledgement.
Pairing sessions expire after five minutes; transfers are limited to 32 MiB of
encoded data. QR and camera libraries load only when opening a device transfer
and are included in the offline application shell.

Both apps must stay open. Camera scanning requires HTTPS (or localhost during
development) and camera permission. Guest-network isolation, VPNs, or networks
that block local peer connections can prevent a connection even on the same
Wi-Fi. Use another shared network or a backup file in that case. Internet access
is not required once the app and its offline assets are installed.

Automated PWA smoke tests exercise actual WebRTC connections and QR decoding
between isolated browser contexts using canvas camera frames. Physical camera
focus, scanning across two phones, and Android installation/offline behavior
should also be checked on devices before release.
