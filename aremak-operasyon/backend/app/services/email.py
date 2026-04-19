import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import List, Tuple
from app.core.config import settings

logger = logging.getLogger(__name__)


def send_shipment_notification(shipment: dict, recipient_email: str, recipient_name: str):
    """Send shipment request notification. Silently skips if SMTP not configured."""
    if not settings.SMTP_PASSWORD or not settings.SMTP_USER:
        logger.warning("SMTP not configured, skipping email notification")
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Yeni Sevk Talebi: {shipment.get('tg_order_name') or shipment.get('customer_name')}"
    msg["From"] = f"Aremak Operasyon <{settings.SMTP_USER}>"
    msg["To"] = recipient_email

    s = shipment
    doc_type = s.get("shipping_doc_type") or "-"
    delivery = s.get("delivery_type") or "-"
    cargo = s.get("cargo_company") or "-"
    date = s.get("planned_ship_date") or "-"
    recipient = s.get("recipient_name") or "-"
    phone = s.get("recipient_phone") or "-"
    address = s.get("delivery_address") or "-"
    notes = s.get("notes") or "-"

    items_html = ""
    for item in s.get("items") or []:
        items_html += f"<tr><td style='padding:4px 8px'>{item.get('product_name','')}</td><td style='padding:4px 8px;text-align:center'>{item.get('quantity','')}</td><td style='padding:4px 8px'>{item.get('shelf','')}</td></tr>"

    html = f"""
<html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto">
<div style="background:#1a3c5e;padding:16px 24px;border-radius:8px 8px 0 0">
  <h2 style="color:#fff;margin:0">Yeni Sevk Talebi</h2>
</div>
<div style="border:1px solid #ddd;border-top:none;padding:24px;border-radius:0 0 8px 8px">
  <p>Merhaba {recipient_name},</p>
  <p>Aşağıdaki sipariş için yeni bir sevk talebi oluşturuldu.</p>

  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold;width:40%">Müşteri</td><td style="padding:6px 12px">{s.get('customer_name','')}</td></tr>
    <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Sipariş</td><td style="padding:6px 12px">{s.get('tg_order_name') or '-'}</td></tr>
    <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Teslim Şekli</td><td style="padding:6px 12px">{delivery}</td></tr>
    <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Kargo Firması</td><td style="padding:6px 12px">{cargo}</td></tr>
    <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Gönderim Belgesi</td><td style="padding:6px 12px">{doc_type}</td></tr>
    <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Planlanan Tarih</td><td style="padding:6px 12px">{date}</td></tr>
    <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Alıcı</td><td style="padding:6px 12px">{recipient}</td></tr>
    <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Alıcı Telefonu</td><td style="padding:6px 12px">{phone}</td></tr>
    <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Teslimat Adresi</td><td style="padding:6px 12px">{address}</td></tr>
    <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:bold">Notlar</td><td style="padding:6px 12px">{notes}</td></tr>
  </table>

  {'<h4 style="margin:16px 0 8px">Kalemler</h4><table style="width:100%;border-collapse:collapse"><thead><tr style="background:#1a3c5e;color:#fff"><th style="padding:6px 8px;text-align:left">Ürün</th><th style="padding:6px 8px">Miktar</th><th style="padding:6px 8px;text-align:left">Raf</th></tr></thead><tbody>' + items_html + '</tbody></table>' if items_html else ''}

  <p style="margin-top:24px;font-size:12px;color:#999">Bu e-posta Aremak Operasyon sistemi tarafından otomatik gönderilmiştir.</p>
</div>
</body></html>
"""

    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_USER, [recipient_email], msg.as_string())
        logger.info(f"Shipment notification sent to {recipient_email}")
    except Exception as e:
        logger.error(f"Failed to send shipment notification: {e}")


def _notif_email(user) -> str:
    """Return the notification email for a User ORM object or dict."""
    if hasattr(user, "notification_email"):
        return user.notification_email or user.email
    return user.get("notification_email") or user.get("email", "")


def _send(subject: str, html: str, recipients: List[Tuple[str, str]]):
    """Generic send helper. recipients = [(email, name), ...]"""
    if not settings.SMTP_PASSWORD or not settings.SMTP_USER:
        return
    for email, name in recipients:
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = f"Aremak Operasyon <{settings.SMTP_USER}>"
            msg["To"] = email
            msg.attach(MIMEText(html.replace("{{name}}", name), "html", "utf-8"))
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
                server.ehlo(); server.starttls()
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.sendmail(settings.SMTP_USER, [email], msg.as_string())
            logger.info(f"Email '{subject}' sent to {email}")
        except Exception as e:
            logger.error(f"Email send failed to {email}: {e}")


def _shipment_summary_rows(s: dict) -> str:
    rows = [
        ("Müşteri",        s.get("customer_name") or "-"),
        ("Sipariş",        s.get("tg_order_name") or "-"),
        ("Teslim Şekli",   s.get("delivery_type") or "-"),
        ("Planlanan Tarih",s.get("planned_ship_date") or "-"),
        ("Gönderim Belgesi",s.get("shipping_doc_type") or "-"),
    ]
    return "".join(
        f"<tr><td style='padding:6px 12px;background:#f5f5f5;font-weight:bold;width:40%'>{k}</td>"
        f"<td style='padding:6px 12px'>{v}</td></tr>"
        for k, v in rows
    )


def _note_block(note: str) -> str:
    if not note:
        return ""
    return (
        f"<div style='margin:16px 0;padding:12px 16px;background:#fffbe6;"
        f"border-left:4px solid #faad14;border-radius:4px'>"
        f"<b style='font-size:12px;color:#ad6800'>NOT</b>"
        f"<p style='margin:4px 0 0;color:#333'>{note}</p></div>"
    )


def _base_email(header_color: str, title: str, body: str) -> str:
    return f"""<html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto">
<div style="background:{header_color};padding:16px 24px;border-radius:8px 8px 0 0">
  <h2 style="color:#fff;margin:0">{title}</h2>
</div>
<div style="border:1px solid #ddd;border-top:none;padding:24px;border-radius:0 0 8px 8px">
  {body}
  <p style="margin-top:24px;font-size:12px;color:#999">Bu e-posta Aremak Operasyon sistemi tarafından otomatik gönderilmiştir.</p>
</div></body></html>"""


def send_pending_admin(shipment: dict, admins: List[Tuple[str, str]], note: str = ""):
    """draft → pending_admin: Admin onayı gerekiyor."""
    rows = _shipment_summary_rows(shipment)
    html = _base_email("#d46b08", "Sevk Talebi Onay Bekliyor",
        f"<p>Merhaba {{{{name}}}},</p>"
        f"<p><b>{shipment.get('tg_order_name') or shipment.get('customer_name')}</b> siparişi için "
        f"sevk talebi oluşturuldu ve onayınızı bekliyor.</p>"
        f"{_note_block(note)}"
        f"<table style='width:100%;border-collapse:collapse;margin:16px 0'>{rows}</table>")
    _send(f"[Yönetici Onayı] Sevk Talebi: {shipment.get('tg_order_name') or shipment.get('customer_name')}", html, admins)


def send_approved_to_warehouse(shipment: dict, warehouse_users: List[Tuple[str, str]], note: str = "", actor_name: str = "Yönetici"):
    """pending_admin → parasut_review: Sevk sorumlusuna Paraşüt kontrolü başlasın."""
    rows = _shipment_summary_rows(shipment)
    html = _base_email("#1a3c5e", "Sevk Talebi Onaylandı — Paraşüt Kontrolü",
        f"<p>Merhaba {{{{name}}}},</p>"
        f"<p><b>{shipment.get('tg_order_name') or shipment.get('customer_name')}</b> siparişinin "
        f"sevk talebi <b>{actor_name}</b> tarafından onaylandı. Lütfen Paraşüt'teki fatura ve irsaliyeyi kontrol edin.</p>"
        f"{_note_block(note)}"
        f"<table style='width:100%;border-collapse:collapse;margin:16px 0'>{rows}</table>")
    _send(f"[Paraşüt Kontrolü] Sevk Talebi: {shipment.get('tg_order_name') or shipment.get('customer_name')}", html, warehouse_users)


def send_waybill_approval_request(shipment: dict, admins: List[Tuple[str, str]], note: str = "", actor_name: str = "Sevk sorumlusu"):
    """parasut_review → pending_parasut_approval: Admin Paraşüt onayı gerekiyor."""
    rows = _shipment_summary_rows(shipment)
    html = _base_email("#531dab", "Paraşüt Onayı Talep Edildi",
        f"<p>Merhaba {{{{name}}}},</p>"
        f"<p><b>{actor_name}</b>, <b>{shipment.get('tg_order_name') or shipment.get('customer_name')}</b> "
        f"siparişi için Paraşüt kontrolünü tamamladı. "
        f"Lütfen Paraşüt'teki fatura ve irsaliyeyi onaylayın.</p>"
        f"{_note_block(note)}"
        f"<table style='width:100%;border-collapse:collapse;margin:16px 0'>{rows}</table>")
    _send(f"[Paraşüt Belgesi Onayı] Sevk Talebi: {shipment.get('tg_order_name') or shipment.get('customer_name')}", html, admins)


def send_ready_to_ship(shipment: dict, warehouse_users: List[Tuple[str, str]], note: str = "", actor_name: str = "Yönetici"):
    """pending_parasut_approval → preparing: Sevk sorumlusuna sevk için hazırlık başlasın."""
    rows = _shipment_summary_rows(shipment)
    html = _base_email("#237804", "Paraşüt Onaylandı — Sevk İçin Hazırla",
        f"<p>Merhaba {{{{name}}}},</p>"
        f"<p><b>{shipment.get('tg_order_name') or shipment.get('customer_name')}</b> siparişinin "
        f"Paraşüt kaydı <b>{actor_name}</b> tarafından onaylandı. Ürünleri hazırlayıp kargo fişi ile sevk edebilirsiniz.</p>"
        f"{_note_block(note)}"
        f"<table style='width:100%;border-collapse:collapse;margin:16px 0'>{rows}</table>")
    _send(f"[Sevke Hazır] Sevk Talebi: {shipment.get('tg_order_name') or shipment.get('customer_name')}", html, warehouse_users)


def send_shipped(shipment: dict, admins: List[Tuple[str, str]], sales_users: List[Tuple[str, str]], note: str = ""):
    """ready_to_ship → shipped: Sevk tamamlandı bildirim."""
    rows = _shipment_summary_rows(shipment)
    html = _base_email("#135200", "Sevk Tamamlandı",
        f"<p>Merhaba {{{{name}}}},</p>"
        f"<p><b>{shipment.get('tg_order_name') or shipment.get('customer_name')}</b> siparişi sevk edildi.</p>"
        f"{_note_block(note)}"
        f"<table style='width:100%;border-collapse:collapse;margin:16px 0'>{rows}</table>")
    subject = f"[Sevk Edildi] {shipment.get('tg_order_name') or shipment.get('customer_name')}"
    _send(subject, html, admins + sales_users)
