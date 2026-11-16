# Test checklist: TrackLine Bot

Only message or call test numbers you own or that agreed to receive test messages.

## A. Automated
| # | Check | Command | Pass when |
|---|---|---|---|
| A1 | Unit + route tests | `npm test` | 19/19 pass |
| A2 | Vapi config fills | `node scripts/setup-vapi.js --dry-run` | no missing placeholders |
| A3 | Health | `GET /api/health` on Vercel | `whatsapp_configured: true`, `vapi_secret_set: true` |

## B. WhatsApp (to the Meta test number)
| # | Send | Expected | Result |
|---|---|---|---|
| B1 | `hi` | Welcome with the tracking format | |
| B2 | `TL20481736` | In-transit status + two buttons | |
| B3 | Tap **Report a problem** → **Wrong item delivered** | Ticket ESC-… (medium); ops alert arrives | |
| B4 | `TL20481742` | Damaged status + "already alerted our support team (ref ESC-…)"; ops alert 🔴 | |
| B5 | `TL20481738 says delivered but I never got it` | High-priority ticket | |
| B6 | `TL12345678` | "couldn't find" reply | |
| B7 | Send a photo | "I can only read text" | |
| B8 | Send B4 again | Same ESC reference (no duplicate ticket) | |

## C. Voice (Vapi "Talk to Assistant")
| # | Say | Expected | Result |
|---|---|---|---|
| C1 | "T L two zero four eight one seven three six" | Reads in-transit status and ETA | |
| C2 | "T L two zero four eight one seven four one" | Held at hub; reads auto-ticket reference | |
| C3 | "My parcel T L 2048 1736 is the wrong item" | `report_problem` → reference read slowly | |
| C4 | "Can I speak to a person?" | Transfer to ops test number (phone calls only) | |
| C5 | Wrong number "T L 1 2 3 4 5 6 7 8" | Reads back what it heard, asks to check | |

## D. Definition of done
- [ ] No real customer data; `.env` not committed
- [ ] Deployed demo link and Loom link at the top of the README
- [ ] Repo description and topics set
