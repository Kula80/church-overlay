# Church Overlay

Lower thirds for church livestreams in OBS: Bible verses, sermon notes
(topic → points → sub-points), name tags, announcements, and a pre-service countdown.

It works the way most pro church tools do with OBS. A small local server runs on
your streaming PC:

- **Overlay** (`overlay.html`): a transparent page that OBS shows as a *Browser Source*.
- **Control panel** (`control.html`): where you type and click. You can dock it inside OBS.

Anything you click in the control panel shows up on stream right away.

## Download

**[⬇ Download Church Overlay for Windows](https://github.com/Kula80/church-overlay/releases/latest/download/church-overlay-windows.zip)**

1. Open the downloaded zip and choose **Extract all**. Don't run it from inside the zip.
2. Open the extracted `church-overlay` folder and double-click `start.bat`. Nothing else needs installing.
3. If Windows says it protected your PC, press **More info**, then **Run anyway**.

A new download has no Bibles, songs, sermons or settings. Download the Bibles again from the Bible tab, and use
**⬆ Restore from backup** on the Style tab to bring your own things back. Keep your backup file somewhere safe:
it isn't stored here.

When replacing an older copy, keep its `data` folder, because that's where your things are saved.

## Requirements

- Windows, using the download above. Otherwise [Node.js](https://nodejs.org) 18 or newer (no other installs needed)
- OBS Studio 28+
- Internet only to download Bibles. Once downloaded, they work offline.

## Start it

Double-click `start.bat`, or run:

```
node server.js
```

Then open http://localhost:5500 in your browser.

## Add it to OBS

1. **Overlay:** In your scene, click **+** → **Browser**.
   - URL: `http://localhost:5500/overlay.html`
   - Width `1920`, Height `1080`
   - Keep it at the top of the source list so it sits over the camera.
2. **Control panel inside OBS (optional):** **Docks → Custom Browser Docks…**
   - Name: `Church Overlay`, URL: `http://localhost:5500/control.html`
   - Dock it anywhere in the OBS window.

You can also run the control panel on a laptop or tablet on the same network:
open `http://<streaming-pc-ip>:5500` (allow Node through Windows Firewall).

## Using it

| Tab | What it does |
| --- | --- |
| **📋 Order** | The order of service: line up verses, names, messages and whole songs before Sunday, then press **Next ▶** (or `N`) through the service. See below. |
| **Bible** | Browse by book, then chapter, then verse, or type a reference (`John 3:16-18`, `Psalm 23`, `Yohane 3:16`). As you type, suggestions pop up: books, then chapters, then verses with a preview (↑ ↓ and Enter, or click). Picking a verse (or typing `Matthew 2:2` and pressing Find) opens the whole chapter and puts that verse on screen straight away, so *Next verse* carries on from there. Click a verse to show it, Shift+click to show a range, or press *Show whole passage*. The same button then says *Show less*, which shows a few verses at a time. The **Verses: 1 2 3** buttons put that many verses on screen straight away; Next › or ↓ moves on. Long passages shrink to fit. Switching translation keeps you on the same chapter. Pick a **+ Second translation** (e.g. Asante Twi) to show every verse in both, one under the other. |
| **Sermon Notes** | Type the outline as the pastor preaches. Click any line to put it on screen. Notes save automatically, and you can keep several sermons. |
| **Songs** | Save worship songs. Lyrics are split into sections (verse, chorus, bridge), and each section can be broken into 2–4 lines per screen. Click a section to show it, and click the chorus again each time it repeats. |
| **Names** | Speaker or worship leader name tags. Save the regulars once and reuse them. Choose the letter case (CAPS, Capitalize Each Word, lowercase) separately for the name and the title. |
| **Messages** | Announcements, prayer lines, and so on, with Show and Hide buttons for each. Also the **💝 Giving** slide (MoMo and bank details with a QR code) and the **📰 Scrolling ticker**. |
| **Countdown** | "Service begins in 04:59", counting to a set time or for a number of minutes. |
| **Style** | Colours, font, size, position, width and animation, applied live. Also the full screen background, corner logo, phone link, Stream Deck buttons and backup. |

### Order of service

1. While preparing, put something on screen (a verse, a name, a message, the giving slide…) and press
   **+ Add to order** under the preview. For a whole song, press **+ Add song to order** on the Songs tab.
2. On the **📋 Order** tab, put things in order with ↑ ↓, or remove them with ✕.
3. During the service press **Next ▶** (or `N` on any tab, or ↓ on the Order tab). A song goes through its
   sections one by one, then moves on to the next item. **◀ Previous** goes back.

### Giving

On the Messages tab, fill in **💝 Giving**: a label, a heading, one line per detail (MoMo number, bank account)
and, if you like, a link or number for the **QR code** that viewers can scan. It saves as you type. Press
**Show giving** at offering time.

### Scrolling ticker

On the Messages tab, type one item per line in **📰 Scrolling ticker**, then press **▶ Start ticker**. It scrolls
along the bottom of the stream while verses, songs and names show above it. Edit it while it runs and it updates.
It is always stopped when the server starts.

### Corner logo

On the Style tab, upload your church logo (a PNG with a see-through background looks best), or type the church
name instead. Choose the corner, size and opacity, then **Show logo**. It stays up the whole service.

### Full screen background

On the Style tab, upload a picture or a short looping video (MP4) to show behind full screen items. The box
colour is laid over it as a tint, so lower *Full screen background opacity* to let more of it show through.

### Use on your phone

The Style tab shows a QR code. Scan it with a phone on the same Wi-Fi and the control panel opens there.
If it doesn't load, allow Node.js through Windows Firewall for private networks.
The phone and the OBS dock stay up to date with each other: what you save on one appears on the other.
If the top bar says **Not connected**, the Church Overlay window has been closed. Start it again and the panel reconnects by itself.

### Stream Deck and remote buttons

On the Style tab is a list of addresses such as `http://<pc-address>:5500/api/remote/next`. In Stream Deck, add a
**Website** action, paste one in and tick **GET request in background**. Available buttons: next, prev, clear,
order-next, order-prev, ticker-on, ticker-off, logo-on, logo-off. Next and Previous work on whichever tab is open
in the control panel, so keep it open (for example docked in OBS). With a phone panel open as well, each panel acts on the button, so close it or keep both on the same tab.

### Backup

**⬇ Download backup** on the Style tab saves your songs, sermon notes, names, messages, order of service, giving,
ticker, logo and style in one file. **⬆ Restore from backup** loads one back (click twice to confirm; it replaces
what's there). Bibles aren't in the backup (download them again), and nor are uploaded pictures and videos.

### Styling sermon notes and messages

In the notes box, select words and use the toolbar: **B**, *I*, U, **AA** for ALL CAPITALS, **Aa** for Capital Letters On Each Word, **aa** for all small letters, a colour, **A+** or **A−**.
Ctrl+B, Ctrl+I and Ctrl+U work too. Pressing **AA** or **aa** again brings back the words as you typed them. **Aa** also changes "HAVE" to "Have" in the
text itself, so pressing it again leaves "Have"; use Ctrl+Z to get "HAVE" back. **• Sub-point** turns the selected lines into sub-points and back, and **Clear styling** removes the styling.
The styling shows on screen and in the list of points. Pasted text comes in plain.
The message text, the giving details and the scrolling ticker on the Messages tab have the same toolbar, without **• Sub-point**.

### When there is a lot of text

Text shrinks by itself to fit the box. If it gets very small, or some of it still cannot fit, a warning
appears under the preview in the control panel. Show fewer verses or lines at a time, or switch to Full screen.

### Align

**Align: Left / Center / Right** sits next to Layout, under the preview. It moves the lower third and lines its
text up the same way, and in full screen it lines up the text. It's the same setting as *Position* on the Style tab.

### Full screen

Under the preview, **Layout: Lower third / Full screen** switches straight away, even for what is on
screen right now. Full screen covers the whole picture with the box colour and shows the text large
(lined up with *Align*), for verses, lyrics, notes, name tags and the countdown. Set how see-through the
backdrop is with *Full screen background opacity* on the Style tab
(lower it to let the camera show through).

### Today's scriptures

Every Bible verse you put on screen is added to **📖 Today's scriptures** (on the Bible tab) by itself.
Verses next to each other join up, so stepping through Matthew 2:1, 2:2 and 2:3 becomes *Matthew 2:1-3*.

Near the end of the sermon, press **Show all on screen** (or **📖 Today's scriptures** on the Sermon Notes
tab) to show the whole list as a recap. Click a reference in the list to open it again, ✕ to remove one, or
**Clear list** to start over. The list starts fresh each day.

### Bibles

Click **Download / manage Bibles** on the Bible tab.

- **Quick add:** KJV, WEB, BSB, Asante Twi, Akuapem Twi and Ewe.
- **📚 English Bible library:** every free English translation (about 50) in one list, best known
  first: KJV, BSB, WEB, NET, ASV, LSV, Geneva 1599, Douay-Rheims, Young's Literal, Darby, and more.
  NIV, ESV, NKJV, NLT and AMP are copyrighted, so they can't be downloaded here; import one if your
  church has a licence for it.
- **Find more:** search 1,200+ free translations by language (French, Yoruba, Hausa, and so on).
  They come from the [Free Use Bible API](https://bible.helloao.org), with texts from eBible.org.
- **Label:** edit the label to change what shows on screen (for example "Asante Twi").
- **Import a file:** for Bibles that aren't in the list. A CSV or TSV file with the columns
  `Book, Chapter, Verse, Text`, or a JSON Bible file. Book names can be English (`John`) or the
  file's own language.

**Ga:** no free Ga Bible is available online. The Ga Bible belongs to the Bible Society of Ghana,
so ask them for a digital copy and permission to use it, then import it.

**Credit:** the Twi and Ewe Bibles are by Biblica, under a CC BY-SA licence. They are free for
church use as long as you credit them. A line like "Scripture: Asante Twi Nkwa Asɛm © Biblica"
in your stream description is enough.

Bibles are saved in `data/bibles`.

### Timer (show and hide by itself)

The **⏱ Timer** box sits under the preview. It can run a name tag or the sermon title.

1. Set *Show for* (for example 30 seconds) and *then hide for* (for example 10 minutes).
2. Start it:
   - **A name:** press **⏱ Timer** on a saved name, or next to the name you typed (Names tab).
   - **The sermon title:** press **⏱ Timer (title)** on the Sermon Notes tab. It shows
     "Today's message" with the title, and follows the title if you edit it or switch sermons.
3. It shows straight away, hides after the show time, comes back after the hide time, and keeps
   repeating, so new viewers can follow along. Press **⏱ Stop** (or *Stop timer*) to end it.

- One thing runs on the timer at a time. Starting it on something else switches over.
- It never covers a verse, song or note. If something is on screen when it is due, it waits until you clear it.
- The timer runs in the server, so it keeps going even if the control panel is closed.
- It is always stopped when the server starts, so it never pops up by surprise.

### Notes format

```
# The Power of Faith
1. Faith is confidence in God
- It is the substance of things hoped for
- It is the evidence of things not seen
2. Faith pleases God
    Without faith it is impossible to please Him
```

- Type the sermon title in the **Sermon title** box. A `# ...` line in the notes also works.
- Each normal line is a **point** (typed numbers like `1.` are removed; points are numbered for you)
- Lines starting with `-` or indented are **sub-points** of the point above them
- *Reveal sub-points one at a time*: when you click a sub-point, the lower third shows the point
  with the sub-points revealed so far, and the newest one highlighted.

### Song format

```
[Verse 1]
Amazing grace how sweet the sound
That saved a wretch like me

[Chorus]
My chains are gone
I've been set free
```

Labels can be `[Anything]` or plain `Verse 2`, `Chorus`, `Bridge`, `Pre-Chorus`, `Tag`,
`Intro`, `Outro`. Without labels, each block separated by a blank line becomes Verse 1, Verse 2, and so on.

### Uploading songs

Press **⬆ Upload songs** on the Songs tab and pick one or more files (you can select many at once):

- **CCLI SongSelect** text files (`.txt`). The title, writers and CCLI song number are read for you, and
  chord lines are removed.
- **ChordPro** files (`.cho`, `.chopro`, `.chordpro`, `.pro`). Chords are removed and sections such as
  `{soc}` (chorus) are labelled.
- **Plain text** lyrics (`.txt`). The file name becomes the song title.

Uploading a song with the same title again replaces the old copy instead of adding a duplicate.

> To show song lyrics on a livestream, your church usually needs a streaming licence
> (for example CCLI Streaming Licence).

### Showing several points at once

- **Show all points**: puts every point on screen with its sub-points. With more than 3 points they split
  into two columns. Long outlines shrink to fit.
- **Keep all points on screen**: while ticked, clicking a point keeps the whole list up, highlights
  that point (with its sub-points) and dims the rest. ↑ ↓ moves the highlight.
- **Side by side**: Ctrl+click 2 or 3 points, then press *Side by side* to compare them in columns,
  each with its sub-points (for example *Flesh* vs *Spirit*).

### Shortcuts (when not typing in a box)

- `↑` / `↓` (or Page Up / Page Down, which work with most presentation clickers): previous/next verse or note line
- `Esc`: clear the screen

## Files

- `server.js`: the local server
- `public/`: overlay and control panel
- `public/richtext.js`, `public/rich.css`: the Word-style text styling
- `data/`: your saved notes, names, messages, style and Bible cache (back this folder up)
- `data/media/`: uploaded logos and backgrounds
- `samples/songs/`: three public-domain hymns to try **⬆ Upload songs** with
