import React, { useEffect, useState } from 'react'
import {
  Card, Descriptions, Tag, Button, Typography, Spin, Divider, Table, message, Popconfirm,
} from 'antd'
import { ArrowLeftOutlined, LinkOutlined, DeleteOutlined, ExportOutlined, FilePdfOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../services/api'

const { Title, Text } = Typography

const stripHtml = (str) => {
  if (!str) return ''
  return str
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

const STATUS_COLORS = { 0: 'blue', 1: 'green', 2: 'red' }
const STATUS_LABELS = { 0: 'Açık', 1: 'Tamamlandı', 2: 'İptal' }

const STAGE_COLORS = {
  draft: 'default', pending_admin: 'orange', preparing: 'blue',
  pending_waybill_approval: 'purple', ready_to_ship: 'cyan', shipped: 'green',
}
const STAGE_LABELS = {
  draft: 'Taslak', pending_admin: 'Admin Onayı Bekleniyor', preparing: 'Hazırlanıyor',
  pending_waybill_approval: 'İrsaliye Onayı Bekleniyor', ready_to_ship: 'Sevke Hazır', shipped: 'Sevk Edildi',
}

export default function OrderDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [order, setOrder] = useState(null)
  const [shipment, setShipment] = useState(null)
  const [invoice, setInvoice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [deletingInvoice, setDeletingInvoice] = useState(false)
  const [invoicePdfLoading, setInvoicePdfLoading] = useState(false)
  const [invoiceDetails, setInvoiceDetails] = useState(null)
  const [irsaliye, setIrsaliye] = useState(null)
  const [irsaliyePdfLoading, setIrsaliyePdfLoading] = useState(false)

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true)
      try {
        const [orderRes, shipmentsRes, invoicesRes] = await Promise.allSettled([
          api.get(`/orders/${id}`),
          api.get('/shipments'),
          api.get('/parasut/invoices'),
        ])

        const o = orderRes.status === 'fulfilled' ? orderRes.value.data : null
        setOrder(o)

        if (shipmentsRes.status === 'fulfilled') {
          const found = shipmentsRes.value.data.find((s) => s.tg_order_id === Number(id))
          setShipment(found || null)
          // Fatura detaylarını çek
          const invId = found?.invoice_url?.split('/').pop()
          if (invId) {
            api.get(`/parasut/invoices/${invId}/details`)
              .then((r) => setInvoiceDetails(r.data))
              .catch(() => {})
          }
          // İrsaliye bilgisini çek
          if (found?.irsaliye_id) {
            api.get(`/parasut/irsaliye/${found.irsaliye_id}`)
              .then((r) => setIrsaliye(r.data))
              .catch(() => {})
          }
        }

        if (invoicesRes.status === 'fulfilled' && o) {
          const invs = invoicesRes.value.data.invoices || []
          const name = (o.RelatedEntity?.Displayname || o.RelatedEntity?.Name || '').trim().toLowerCase()
          const found = invs.find((inv) => (inv.contact_name_normalized || '').includes(name.slice(0, 15)) || name.includes((inv.contact_name_normalized || '').slice(0, 15)))
          setInvoice(found || null)
        }
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [id])

  const deleteInvoice = async () => {
    if (!shipment) return
    setDeletingInvoice(true)
    try {
      const res = await api.delete(`/shipments/${shipment.id}/invoice`)
      setShipment(res.data)
      setInvoice(null)
      message.success('Fatura silindi')
    } catch (e) {
      message.error(e.response?.data?.detail || 'Fatura silinemedi')
    } finally {
      setDeletingInvoice(false)
    }
  }

  const openInvoicePdf = async () => {
    const invId = invoice?.id || shipment?.invoice_url?.split('/').pop()
    if (!invId) return
    setInvoicePdfLoading(true)
    try {
      const res = await api.get(`/parasut/invoices/${invId}/pdf-url`)
      window.open(res.data.url, '_blank')
    } catch {
      message.error('Fatura PDF\'i henüz hazır değil')
    } finally {
      setInvoicePdfLoading(false)
    }
  }

  const openIrsaliyePdf = async () => {
    if (!shipment?.irsaliye_id) return
    setIrsaliyePdfLoading(true)
    try {
      const res = await api.get(`/parasut/irsaliye/${shipment.irsaliye_id}/pdf-url`)
      window.open(res.data.url, '_blank')
    } catch {
      message.error('İrsaliye PDF\'i henüz hazır değil')
    } finally {
      setIrsaliyePdfLoading(false)
    }
  }

  const openTeamGram = async () => {
    try {
      const res = await api.get(`/orders/${id}/weblink`)
      window.open(res.data.url, '_blank')
    } catch {
      message.error('Link alınamadı')
    }
  }

  const cfById = Object.fromEntries((order?.CustomFieldDatas || []).map((f) => [String(f.CustomFieldId), f]))
  const parseCfSelectId = (cf) => {
    try { return String(JSON.parse(cf?.Value ?? 'null')?.Id ?? '') } catch { return String(cf?.Value ?? '') }
  }
  const odemeVal = parseCfSelectId(cfById['193501'])
  const odemeDurumu = odemeVal === '14858' ? 'Ödendi' : odemeVal === '14859' ? 'Ödenecek' : '-'
  const beklenenTarih = cfById['193502']?.UnFormattedDate || cfById['193502']?.Value?.slice(0, 10) || '-'

  const itemColumns = [
    { title: 'Ürün', key: 'name', render: (_, r) => r.Product?.Displayname || r.Title || '-' },
    { title: 'Miktar', dataIndex: 'Quantity', key: 'qty', width: 80 },
    { title: 'Birim Fiyat', key: 'price', width: 150, render: (_, r) => `${Number(r.Price || 0).toLocaleString('tr-TR')} ${r.CurrencyName || order?.CurrencyName || ''}` },
    { title: 'KDV', key: 'vat', width: 70, render: (_, r) => `%${r.Vat || 0}` },
    { title: 'Toplam', key: 'total', width: 150, render: (_, r) => `${Number(r.LineTotal || 0).toLocaleString('tr-TR')} ${r.CurrencyName || order?.CurrencyName || ''}` },
  ]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/orders')}>Geri</Button>
        <Title level={4} style={{ margin: 0 }}>{order?.Displayname || 'Sipariş Detayı'}</Title>
        <Button icon={<LinkOutlined />} size="small" onClick={openTeamGram}>TeamGram'da Aç</Button>
      </div>

      <Spin spinning={loading}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Sipariş Bilgileri */}
          <Card title="Sipariş Bilgileri">
            <Descriptions column={2} size="small">
              <Descriptions.Item label="Müşteri">
                {order?.RelatedEntity?.Displayname || order?.RelatedEntity?.Name || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Sipariş Tarihi">
                {order?.OrderDate?.slice(0, 10) || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Durum">
                {order ? <Tag color={STATUS_COLORS[order.Status]}>{STATUS_LABELS[order.Status]}</Tag> : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Aşama">
                {order?.CustomStageName || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Tutar (KDV Dahil)">
                {order?.DiscountedTotal ? `${Number(order.DiscountedTotal).toLocaleString('tr-TR')} ${order.CurrencyName}` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Teslimat Adresi" span={2}>
                {order?.DeliveryAddress ? stripHtml(order.DeliveryAddress) : '-'}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {/* Ödeme Bilgileri */}
          <Card title="Ödeme Bilgileri">
            <Descriptions column={2} size="small">
              <Descriptions.Item label="Ödeme Durumu">
                <Tag color={odemeDurumu === 'Ödendi' ? 'green' : odemeDurumu === 'Ödenecek' ? 'orange' : 'default'}>
                  {odemeDurumu}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Beklenen Ödeme Tarihi">{beklenenTarih}</Descriptions.Item>
            </Descriptions>
          </Card>

          {/* Fatura Bilgileri */}
          <Card title="Fatura (Paraşüt)">
            {(shipment?.invoice_url || shipment?.invoice_no || invoice) ? (
              <>
                <Descriptions column={2} size="small">
                  {invoiceDetails?.contact_name && (
                    <Descriptions.Item label="Müşteri" span={2}>{invoiceDetails.contact_name}</Descriptions.Item>
                  )}
                  <Descriptions.Item label="Fatura No">
                    {(shipment?.invoice_no || invoice?.invoice_no || invoiceDetails?.invoice_no)
                      ? (shipment?.invoice_no || invoice?.invoice_no || invoiceDetails.invoice_no)
                      : <Tag color="orange">Onay Bekleniyor</Tag>}
                  </Descriptions.Item>
                  {(invoice?.issue_date || invoiceDetails?.issue_date) && (
                    <Descriptions.Item label="Fatura Tarihi">{invoice?.issue_date || invoiceDetails.issue_date}</Descriptions.Item>
                  )}
                  {(invoice?.net_total || invoiceDetails?.net_total) && (
                    <Descriptions.Item label="Tutar (KDV Dahil)">
                      {Number(invoice?.net_total || invoiceDetails.net_total).toLocaleString('tr-TR')} {invoice?.currency || invoiceDetails?.currency}
                    </Descriptions.Item>
                  )}
                  {invoiceDetails?.description && (
                    <Descriptions.Item label="Açıklama">{invoiceDetails.description}</Descriptions.Item>
                  )}
                  {shipment?.invoice_note && (
                    <Descriptions.Item label="Fatura Notu" span={2}>{shipment.invoice_note}</Descriptions.Item>
                  )}
                </Descriptions>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <Button
                    icon={<FilePdfOutlined />}
                    size="small"
                    loading={invoicePdfLoading}
                    onClick={openInvoicePdf}
                    style={{ color: '#ff4d4f', borderColor: '#ff4d4f' }}
                  >
                    Fatura PDF
                  </Button>
                  {(invoice?.url || shipment?.invoice_url) && (
                    <Button
                      icon={<ExportOutlined />}
                      size="small"
                      href={invoice?.url || shipment.invoice_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Paraşüt'te Görüntüle
                    </Button>
                  )}
                  {shipment && (
                    <Popconfirm
                      title="Faturayı sil"
                      description="Bu fatura Paraşüt'ten silinecek ve sevkiyat kaydından kaldırılacak. Emin misiniz?"
                      onConfirm={deleteInvoice}
                      okText="Evet, Sil"
                      cancelText="Vazgeç"
                      okButtonProps={{ danger: true }}
                    >
                      <Button danger icon={<DeleteOutlined />} size="small" loading={deletingInvoice}>
                        Faturayı Sil
                      </Button>
                    </Popconfirm>
                  )}
                </div>
              </>
            ) : (
              <Typography.Text type="secondary">Bu sipariş için fatura kaydı yok.</Typography.Text>
            )}
          </Card>

          {/* İrsaliye Bilgileri */}
          {shipment?.irsaliye_id && (
            <Card title="İrsaliye (Paraşüt)">
              <Descriptions column={2} size="small">
                {irsaliye?.contact_name && (
                  <Descriptions.Item label="Müşteri" span={2}>{irsaliye.contact_name}</Descriptions.Item>
                )}
                <Descriptions.Item label="İrsaliye No">
                  {irsaliye?.irsaliye_no
                    ? irsaliye.irsaliye_no
                    : <Tag color="orange">Onay Bekleniyor</Tag>}
                </Descriptions.Item>
                {irsaliye?.issue_date && (
                  <Descriptions.Item label="Düzenleme Tarihi">{irsaliye.issue_date}</Descriptions.Item>
                )}
                {irsaliye?.shipment_date && (
                  <Descriptions.Item label="Sevk Tarihi">{irsaliye.shipment_date?.slice(0, 10)}</Descriptions.Item>
                )}
                {irsaliye?.description && (
                  <Descriptions.Item label="Açıklama">{irsaliye.description}</Descriptions.Item>
                )}
              </Descriptions>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <Button
                  icon={<FilePdfOutlined />}
                  size="small"
                  loading={irsaliyePdfLoading}
                  onClick={openIrsaliyePdf}
                  style={{ color: '#ff4d4f', borderColor: '#ff4d4f' }}
                >
                  İrsaliye PDF
                </Button>
                <Button
                  icon={<ExportOutlined />}
                  size="small"
                  href={irsaliye?.url || `https://uygulama.parasut.com/627949/irsaliyeler/${shipment.irsaliye_id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Paraşüt'te Görüntüle
                </Button>
              </div>
            </Card>
          )}

          {/* Kalemler */}
          {order?.Items?.length > 0 && (
            <Card title="Sipariş Kalemleri">
              <Table
                dataSource={order.Items}
                columns={itemColumns}
                rowKey="ItemId"
                pagination={false}
                size="small"
              />
            </Card>
          )}

          {/* Sevkiyat */}
          <Card
            title="Sevkiyat"
            extra={shipment && (
              <Button size="small" onClick={() => navigate(`/shipments/${shipment.id}`)}>
                Sevkiyat Detayı
              </Button>
            )}
          >
            {shipment ? (
              <Descriptions column={2} size="small">
                <Descriptions.Item label="Aşama">
                  <Tag color={STAGE_COLORS[shipment.stage]}>{STAGE_LABELS[shipment.stage] || shipment.stage_label}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Teslim Şekli">{shipment.delivery_type || '-'}</Descriptions.Item>

                <Descriptions.Item label="Planlanan Tarih">{shipment.planned_ship_date || '-'}</Descriptions.Item>
                <Descriptions.Item label="Gönderim Belgesi">{shipment.shipping_doc_type || '-'}</Descriptions.Item>

                {shipment.delivery_type === 'Kargo' && <>
                  <Descriptions.Item label="Kargo Firması">{shipment.cargo_company || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Takip No">{shipment.cargo_tracking_no || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Alıcı">{shipment.recipient_name || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Alıcı Telefonu">{shipment.recipient_phone || '-'}</Descriptions.Item>
                </>}

                {(shipment.delivery_address || shipment.delivery_district || shipment.delivery_city) && (
                  <Descriptions.Item label="Sevkiyat Adresi" span={2}>
                    {[shipment.delivery_address, shipment.delivery_district, shipment.delivery_city, shipment.delivery_zip]
                      .filter(Boolean).join(', ')}
                  </Descriptions.Item>
                )}

                {shipment.notes && <Descriptions.Item label="Notlar" span={2}>{shipment.notes}</Descriptions.Item>}
              </Descriptions>
            ) : (
              <Text type="secondary">Bu sipariş için henüz sevkiyat kaydı yok.</Text>
            )}
          </Card>

        </div>
      </Spin>
    </div>
  )
}
