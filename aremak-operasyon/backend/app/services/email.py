import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
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
