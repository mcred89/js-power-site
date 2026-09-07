# Workout Generator: JS edition

The code in this repo deploys a serverless React website into AWS S3.

## Tabata sprint finishers

In **Build your routine**, select Squat, Press, or Deadlift days under **Tabata
sprints**. Each selected day ends with eight rounds of 20 seconds sprinting and
10 seconds rest. Tabata can be enabled alongside Strongman events and always
follows the main lift, back-off sets, accessories, and Strongman work.

The installed tracker treats the whole finisher as one set. **Start timer** runs
a one-minute warm-up, then the sprints and rests automatically, completing the
set after the last sprint. Eight sprints take 4:50 including warm-up; there is no
rest after the final sprint. The timer fills the screen with green for warm-up,
red for sprinting, and blue for rest, with sprint count, elapsed time, and a
countdown. Distinct buzzers announce each transition. Keep the app open and set
your phone's media volume before starting. Pause, resume, and reset are available;
after a reload, tap Resume to re-enable sound and continue the saved timer.
Selections and timer progress are included in backups. Existing saved plans keep
their prescriptions and default to Tabata off.

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
