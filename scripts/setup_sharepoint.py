"""One-time Microsoft 365 setup for IBA Time Clock (run by an admin):

    ~/claude-remote/.venv/bin/python scripts/setup_sharepoint.py

- Creates the private "IBA Time Clock" Microsoft 365 group (welcome email off, hidden
  from Outlook) with the signed-in admin as owner. Its SharePoint site holds the data.
  Group OWNERS are the clock's admins; MEMBERS are staff.
- Creates the lists below (safe to re-run: only adds what's missing).
- Lets the existing "IBA Boards" sign-in app also sign people in at time.ibakings.org,
  so staff approve nothing new.
- Writes the ids to src/config.json.

Uses the "Claude for IBA" Graph app (~/claude-remote/scripts/msgraph.py).
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path.home() / "claude-remote" / "scripts"))
from msgraph import graph  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TENANT = "8cf8db3d-c972-4e9b-9948-a420750a34fb"
SIGNIN_APP = "cef1b1f7-f229-4feb-afb2-2deebd4735e4"  # the "IBA Boards" app registration
REDIRECTS = ["https://time.ibakings.org/", "http://localhost:5175/"]
RETIRED = ["https://clock.ibakings.org/"]  # earlier address, no longer used

TEXT = {"text": {}}
LONG = {"text": {"allowMultipleLines": True, "textType": "plain", "linesForEditing": 6}}
NUM = {"number": {}}
# list -> {column: (definition, indexed)}. Every list also has Title.
SCHEMA = {
    "Staff": {"Key": (TEXT, True), "Email": (TEXT, True), "Role": (TEXT, False), "Active": (NUM, False),
              "DefaultJob": (TEXT, False), "Color": (TEXT, False)},
    "Locations": {"Key": (TEXT, True), "Lat": (NUM, False), "Lng": (NUM, False), "Radius": (NUM, False),
                  "Mode": (TEXT, False), "Active": (NUM, False)},
    "Jobs": {"Key": (TEXT, True), "LocationKey": (TEXT, False), "Color": (TEXT, False), "Active": (NUM, False)},
    "Punches": {"Key": (TEXT, True), "PersonEmail": (TEXT, True), "Day": (TEXT, True), "Kind": (TEXT, False),
                "At": (TEXT, False), "ClientTime": (TEXT, False), "JobKey": (TEXT, False), "LocationKey": (TEXT, False),
                "Lat": (NUM, False), "Lng": (NUM, False), "Accuracy": (NUM, False), "Inside": (NUM, False),
                "Method": (TEXT, False), "Note": (LONG, False), "EnteredBy": (TEXT, False), "Voided": (NUM, False)},
    "Approvals": {"Key": (TEXT, True), "PersonEmail": (TEXT, True), "PeriodStart": (TEXT, True),
                  "ApprovedBy": (TEXT, False), "ApprovedAt": (TEXT, False), "Note": (LONG, False)},
    "Settings": {"Key": (TEXT, True), "Json": (LONG, False)},
}


def all_pages(path):
    out, url = [], path
    while url:
        d = graph("GET", url)
        out += d.get("value", [])
        url = d.get("@odata.nextLink")
    return out


me = graph("GET", "/me?$select=id,userPrincipalName")
groups = graph("GET", "/groups?$filter=displayName eq 'IBA Time Clock'&$select=id")["value"]
if groups:
    gid = groups[0]["id"]
    print("group exists", gid)
else:
    gid = graph("POST", "/groups", json={
        "displayName": "IBA Time Clock", "description": "Data for the IBA Time Clock app. Owners are clock admins. Private.",
        "mailEnabled": True, "mailNickname": "ibatimeclock", "securityEnabled": False, "groupTypes": ["Unified"],
        "visibility": "Private", "resourceBehaviorOptions": ["WelcomeEmailDisabled", "HideGroupInOutlook"],
        "owners@odata.bind": [f"https://graph.microsoft.com/v1.0/users/{me['id']}"],
        "members@odata.bind": [f"https://graph.microsoft.com/v1.0/users/{me['id']}"],
    })["id"]
    print("created group", gid)

site = None
for _ in range(30):
    try:
        site = graph("GET", f"/groups/{gid}/sites/root?$select=id,webUrl")
        break
    except Exception:
        print("waiting for SharePoint to create the site…")
        time.sleep(10)
if not site:
    sys.exit("The site isn't ready yet; run this again in a few minutes.")
sid = site["id"]
print("site", site["webUrl"])

lists = {l["displayName"]: l["id"] for l in all_pages(f"/sites/{sid}/lists?$select=id,displayName")}
for name, cols in SCHEMA.items():
    if name not in lists:
        lists[name] = graph("POST", f"/sites/{sid}/lists", json={
            "displayName": name, "list": {"template": "genericList"},
            "columns": [{"name": c, **d, "indexed": idx} for c, (d, idx) in cols.items()]})["id"]
        print("created list", name)
    else:
        have = {c["name"] for c in all_pages(f"/sites/{sid}/lists/{lists[name]}/columns?$select=name")}
        for c, (d, idx) in cols.items():
            if c not in have:
                graph("POST", f"/sites/{sid}/lists/{lists[name]}/columns", json={"name": c, **d, "indexed": idx})
                print("added column", name, c)

# The signed-in admin is the first clock admin.
staff = all_pages(f"/sites/{sid}/lists/{lists['Staff']}/items?$expand=fields($select=Email)")
email = me["userPrincipalName"].lower()
if not any((s["fields"].get("Email") or "").lower() == email for s in staff):
    graph("POST", f"/sites/{sid}/lists/{lists['Staff']}/items", json={"fields": {
        "Key": "s-admin", "Title": "Garrett Greene", "Email": email, "Role": "admin", "Active": 1, "Color": "#e8697d"}})
    print("added", email, "as admin")

# Sign-in addresses for the clock on the existing IBA Boards app.
app = graph("GET", f"/applications(appId='{SIGNIN_APP}')?$select=id,spa")
uris = app["spa"]["redirectUris"]
wanted = [u for u in uris if u not in RETIRED] + [u for u in REDIRECTS if u not in uris]
if wanted != uris:
    graph("PATCH", f"/applications/{app['id']}", json={"spa": {"redirectUris": wanted}})
    print("sign-in addresses now:", ", ".join(wanted))

cfg = {"tenantId": TENANT, "clientId": SIGNIN_APP, "groupId": gid, "siteId": sid, "siteUrl": site["webUrl"]}
(ROOT / "src" / "config.json").write_text(json.dumps(cfg, indent=2) + "\n")
print("saved src/config.json")
