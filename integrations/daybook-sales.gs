/**
 * Daybook Sales: Google connector (Gmail, Calendar, Meet transcripts).
 *
 * Free. Runs in your own Google account. Nothing leaves Google except what is posted to your own Daybook.
 * Setup (5 minutes, once):
 *   1. Open https://script.google.com, New project, paste this whole file.
 *   2. Replace DAYBOOK_URL and SECRET below with the values shown in Daybook (Sales, Settings, Google).
 *   3. Run "setup" once and allow the permissions (Gmail, Calendar, Drive read, external requests).
 *   4. Deploy, New deployment, type "Web app", Execute as: Me, Who has access: Anyone. Copy the /exec URL
 *      into Daybook (Sales, Settings, Google) so Daybook can send email from your Gmail.
 * After that it syncs every 5 minutes on its own.
 */

var DAYBOOK_URL = 'https://YOUR-APP.vercel.app';
var SECRET = 'PASTE-THE-SECRET-FROM-DAYBOOK';

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sync').timeBased().everyMinutes(5).create();
  sync();
}

function sync() {
  var cfg = config_();
  try { syncGmail_(cfg); } catch (e) { console.error('gmail', e); }
  try { syncCalendar_(); } catch (e) { console.error('calendar', e); }
  try { syncTranscripts_(); } catch (e) { console.error('transcripts', e); }
}

function post_(kind, items) {
  var res = UrlFetchApp.fetch(DAYBOOK_URL.replace(/\/+$/, '') + '/api/sales/google', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ secret: SECRET, kind: kind, items: items || [] }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error(kind + ' ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText() || '{}');
}

function config_() {
  try { return post_('config', []); } catch (e) { return { domains: [] }; }
}

function syncGmail_(cfg) {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty('gmail_last') || (Date.now() - 2 * 86400000));
  var after = Math.floor(last / 1000) - 900;
  var alerts = (cfg.domains || []).map(function (d) { return 'from:' + d; }).join(' OR ');
  var query = 'after:' + after + ' -in:chats -in:spam -in:trash ((in:inbox category:primary) OR in:sent' + (alerts ? ' OR ' + alerts : '') + ')';
  var threads = GmailApp.search(query, 0, 60);
  var me = Session.getActiveUser().getEmail().toLowerCase();
  var items = [];
  var max = last;
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      var ts = m.getDate().getTime();
      if (ts < last - 900000) return;
      if (ts > max) max = ts;
      var from = m.getFrom();
      items.push({
        id: m.getId(), threadId: t.getId(), from: from, to: m.getTo(), cc: m.getCc(), subject: m.getSubject(),
        date: m.getDate().toISOString(), body: m.getPlainBody().slice(0, 12000), outbound: from.toLowerCase().indexOf(me) >= 0,
      });
    });
  });
  for (var i = 0; i < items.length; i += 15) post_('gmail', items.slice(i, i + 15));
  props.setProperty('gmail_last', String(max));
}

function syncCalendar_() {
  var props = PropertiesService.getScriptProperties();
  var lastRun = Number(props.getProperty('cal_last') || 0);
  if (Date.now() - lastRun < 25 * 60000) return;
  var now = new Date();
  var events = CalendarApp.getDefaultCalendar().getEvents(new Date(now.getTime() - 86400000), new Date(now.getTime() + 21 * 86400000));
  var items = events.map(function (e) {
    var desc = e.getDescription() || '';
    var link = (desc.match(/https:\/\/meet\.google\.com\/[a-z-]+/) || [])[0] || (e.getLocation() || '');
    return {
      id: e.getId() + '|' + e.getStartTime().getTime(), title: e.getTitle(), start: e.getStartTime().toISOString(), end: e.getEndTime().toISOString(),
      attendees: e.getGuestList(true).map(function (g) { return { email: g.getEmail(), name: g.getName() }; }),
      description: desc.slice(0, 3000), link: link,
      cancelled: e.getMyStatus() === CalendarApp.GuestStatus.NO,
    };
  });
  for (var i = 0; i < items.length; i += 25) post_('calendar', items.slice(i, i + 25));
  props.setProperty('cal_last', String(Date.now()));
}

function syncTranscripts_() {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty('docs_last') || (Date.now() - 3 * 86400000));
  var since = new Date(last - 3600000).toISOString();
  var files = DriveApp.searchFiles(
    'mimeType = "application/vnd.google-apps.document" and modifiedDate > "' + since + '" and (title contains "Transcript" or title contains "Notes by Gemini" or title contains "Meeting notes")'
  );
  var items = [];
  while (files.hasNext() && items.length < 10) {
    var f = files.next();
    var text = DocumentApp.openById(f.getId()).getBody().getText();
    items.push({ id: f.getId(), title: f.getName(), created: f.getDateCreated().toISOString(), text: text.slice(0, 40000) });
  }
  if (items.length) post_('transcript', items);
  props.setProperty('docs_last', String(Date.now()));
}

/** Daybook calls this to send email from your Gmail (one-tap send). */
function doPost(e) {
  var out = { ok: false };
  try {
    var req = JSON.parse(e.postData.contents);
    if (req.secret !== SECRET) throw new Error('bad secret');
    if (req.action === 'send') {
      var msg;
      if (req.threadId) {
        msg = GmailApp.getThreadById(req.threadId).createDraftReply(req.body).send();
      } else {
        msg = GmailApp.createDraft(req.to, req.subject, req.body).send();
      }
      out = { ok: true, id: msg.getId(), threadId: msg.getThread().getId() };
    } else if (req.action === 'ping') {
      out = { ok: true, email: Session.getActiveUser().getEmail() };
    }
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
