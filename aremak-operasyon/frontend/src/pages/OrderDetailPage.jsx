import React, { useEffect, useState } from 'react'
import {
  Card, Descriptions, Tag, Button, Typography, Spin, Divider, Table, message, Popconfirm, Space, Row, Col,
  Drawer, InputNumber, Modal, Alert,
} from 'antd'
import { ArrowLeftOutlined, LinkOutlined, DeleteOutlined, ExportOutlined, FilePdfOutlined, BranchesOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../services/api'

const attachmentUrl = (url) => `/api/orders/proxy/attachment?url=${encodeURIComponent(url)}`

const parseTgNumber = (val) => {
  if (val == null || val === '') return NaN
  const s = String(val).trim()
  const lastComma = s.lastIndexOf(',')
  const lastPeriod = s.lastIndexOf('.')
  if (lastComma === -1 && lastPeriod === -1) return parseFloat(s)
  if (lastComma > lastPeriod) return parseFloat(s.replace(/\./g, '').replace(',', '.'))
  return parseFloat(s.replace(/,/g, ''))
}

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
  draft: 'default', pending_admin: 'orange', parasut_review: 'blue',
  pending_parasut_approval: 'purple', preparing: 'cyan', shipped: 'green',
}
const STAGE_LABELS = {
  draft: 'Taslak', pending_admin: 'Yönetici Onayı Bekleniyor', parasut_review: 'Paraşüt Kontrolü Yapılıyor',
  pending_parasut_approval: 'Paraşüt Onayı Bekleniyor', preparing: 'Sevk İçin Hazırlanıyor', shipped: 'Sevk Edildi',
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
  const [lineItems, setLineItems] = useState(null)
  const [lineItemsLoading, setLineItemsLoading] = useState(false)
  // ─── Parçalı Sipariş ───
  const [splitOpen, setSplitOpen] = useState(false)
  const [splitItems, setSplitItems] = useState([])     // {tg_product_id, displayname, ordered_qty, in_stock, stock_local, price, currency, vat, unit, description}
  const [splitting, setSplitting] = useState(false)

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
          // Kalem karşılaştırma
          if (found?.id) {
            setLineItemsLoading(true)
            api.get(`/shipments/${found.id}/line-items`)
              .then((r) => setLineItems(r.data))
              .catch(() => {})
              .finally(() => setLineItemsLoading(false))
          }
        }

        if (invoicesRes.status === 'fulfilled' && o) {
          const invs = invoicesRes.value.data.invoices || []
          const normTR = (s) => (s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').trim().toLocaleLowerCase('tr-TR')
          const name = normTR(o.RelatedEntity?.Displayname || o.RelatedEntity?.Name || '')
          const orderDisplay = (o.Displayname || '').trim()

          // 1. Önce sipariş adıyla TAM description eşleşmesi (en güvenilir)
          let found = null
          if (orderDisplay) {
            found = invs.find((inv) => (inv.description || '').trim() === orderDisplay)
          }

          // 2. Yoksa partial description eşleşmesi (sipariş adı invoice description içinde)
          if (!found && orderDisplay) {
            const orderDispNorm = normTR(orderDisplay)
            found = invs.find((inv) => {
              const desc = normTR(inv.description || '')
              return desc && (desc === orderDispNorm || desc.includes(orderDispNorm) || orderDispNorm.includes(desc))
            })
          }

          // 3. Yoksa müşteri adıyla eşleşme (eski mantık)
          if (!found) {
            found = invs.find((inv) => {
              const cn = inv.contact_name_normalized || ''
              return cn === name || cn.includes(name.slice(0, 20)) || name.includes(cn.slice(0, 20))
            })
          }

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
  const odemeTutariParsed = parseTgNumber(cfById['193526']?.Value)
  const odemeTutari = !isNaN(odemeTutariParsed) ? odemeTutariParsed : null
  const odemePbRaw = (() => { try { return JSON.parse(cfById['193527']?.Value ?? 'null')?.Value } catch { return null } })()
  let odemeBelgeleri = null
  try { odemeBelgeleri = JSON.parse(cfById['193472']?.Value || 'null') } catch {}

  const itemColumns = [
    { title: 'Ürün', key: 'name', render: (_, r) => r.Product?.Displayname || r.Title || '-' },
    { title: 'Miktar', dataIndex: 'Quantity', key: 'qty', width: 80 },
    { title: 'Birim Fiyat', key: 'price', width: 150, render: (_, r) => `${Number(r.Price || 0).toLocaleString('tr-TR')} ${r.CurrencyName || order?.CurrencyName || ''}` },
    { title: 'KDV', key: 'vat', width: 70, render: (_, r) => `%${r.Vat || 0}` },
    { title: 'Toplam', key: 'total', width: 150, render: (_, r) => `${Number(r.LineTotal || 0).toLocaleString('tr-TR')} ${r.CurrencyName || order?.CurrencyName || ''}` },
  ]

  // ─── Parçalı Sipariş ───
  const canSplit = order && order.Status === 0 && !order.IsSplit && !shipment

  const openSplitDrawer = async () => {
    if (!order?.Items?.length) return
    // Her ürün için lokal stok bilgisini parallel çek
    const stockResults = await Promise.all(
      order.Items.map((it) =>
        api.get(`/orders/products/${it.Product?.Id}/stock`)
          .then((r) => r.data?.inventory ?? 0)
          .catch(() => 0)
      )
    )
    const items = order.Items.map((it, i) => {
      const ordered = Number(it.Quantity) || 0
      const stock = Number(stockResults[i]) || 0
      const inStock = Math.min(stock, ordered)
      return {
        tg_product_id: it.Product?.Id,
        displayname: it.Product?.Displayname || it.Title || '-',
        ordered_qty: ordered,
        in_stock: inStock,
        stock_local: stock,
        price: Number(it.Price) || 0,
        currency: it.CurrencyName || order.CurrencyName || 'USD',
        vat: it.Vat ?? 20,
        unit: it.Unit || 'adet',
        description: it.Description || null,
      }
    })
    setSplitItems(items)
    setSplitOpen(true)
  }

  const updateSplitItem = (idx, field, value) => {
    setSplitItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it))
  }

  const handleSplit = async () => {
    const hasInStock = splitItems.some((it) => it.in_stock > 0)
    const hasWaiting = splitItems.some((it) => (it.ordered_qty - it.in_stock) > 0)
    if (!hasInStock || !hasWaiting) {
      message.warning('Parçalı sipariş için hem "Hemen Sevk" hem "Tedarik Bekliyor" kısmı dolu olmalı')
      return
    }
    setSplitting(true)
    try {
      const payload = {
        items: splitItems.map((it) => ({
          tg_product_id: it.tg_product_id,
          ordered_qty: it.ordered_qty,
          in_stock_qty: it.in_stock,
          price: it.price,
          currency: it.currency,
          vat: it.vat,
          unit: it.unit,
          description: it.description,
        })),
      }
      const r = await api.post(`/orders/${id}/split`, payload)
      Modal.success({
        title: 'Parçalı sipariş oluşturuldu',
        content: (
          <div>
            <p>İki sipariş yaratıldı:</p>
            <ul>
              <li>Hemen Sevk: <a onClick={() => navigate(`/orders/${r.data.in_stock_order_id}`)}>#{r.data.in_stock_order_id}</a></li>
              <li>Tedarik Bekliyor: <a onClick={() => navigate(`/orders/${r.data.waiting_order_id}`)}>#{r.data.waiting_order_id}</a></li>
            </ul>
          </div>
        ),
        onOk: () => navigate('/orders'),
      })
      setSplitOpen(false)
    } catch (e) {
      message.error(e?.response?.data?.detail || 'Bölme başarısız')
    } finally {
      setSplitting(false)
    }
  }

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
          <Card
            title={
              <Space>
                <span>Sipariş Bilgileri</span>
                {order?.IsSplit && <Tag color="purple">BÖLÜNDÜ</Tag>}
              </Space>
            }
            extra={
              canSplit && (
                <Button icon={<BranchesOutlined />} onClick={openSplitDrawer}>
                  Parçalı Sipariş Oluştur
                </Button>
              )
            }
          >
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
              {odemeTutari != null && (
                <Descriptions.Item label="Ödeme Tutarı">
                  {odemeTutari.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} {odemePbRaw || ''}
                </Descriptions.Item>
              )}
            </Descriptions>
            {odemeBelgeleri?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <Typography.Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>Ödeme Belgesi</Typography.Text>
                <Space wrap>
                  {odemeBelgeleri.map((b, i) => (
                    <a key={i} href={attachmentUrl(b.Url)} target="_blank" rel="noreferrer">
                      <img
                        src={attachmentUrl(b.Url)}
                        alt={b.FileName}
                        style={{ height: 64, borderRadius: 4, border: '1px solid #d9d9d9', objectFit: 'cover', display: 'block' }}
                        onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block' }}
                      />
                      <div style={{ display: 'none', fontSize: 11, color: '#1677ff' }}>{b.FileName}</div>
                    </a>
                  ))}
                </Space>
              </div>
            )}
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
                  href={irsaliye?.url || `https://uygulama.parasut.com/627949/giden-irsaliyeler/${shipment.irsaliye_id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Paraşüt'te Görüntüle
                </Button>
              </div>
            </Card>
          )}

          {/* Kalem Özeti */}
          <Card
            title="Kalem Özeti"
            size="small"
            extra={lineItemsLoading ? <Spin size="small" /> : null}
          >
            <Row gutter={24}>
              <Col span={8}>
                <Typography.Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8, color: '#1677ff' }}>Sipariş (TG)</Typography.Text>
                {(lineItems?.tg_items || order?.Items || []).length > 0
                  ? (lineItems?.tg_items || order?.Items || []).map((item, i) => {
                      const name = item.product_name ?? (item.Product?.Displayname || item.Title || '-')
                      const code = item.product_code ?? item.Product?.Sku ?? ''
                      const qty = item.quantity ?? item.Quantity ?? 0
                      const price = item.unit_price ?? item.Price ?? 0
                      const currency = item.currency ?? item.CurrencyName ?? order?.CurrencyName ?? ''
                      return (
                        <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}>
                          <div style={{ fontWeight: 500, marginBottom: 2 }}>{name}</div>
                          {code && <div style={{ color: '#888', fontSize: 11 }}>{code}</div>}
                          <div style={{ color: '#555' }}>
                            {qty} adet{price ? ` · ${Number(price).toLocaleString('tr-TR')} ${currency}` : ''}
                          </div>
                        </div>
                      )
                    })
                  : <Typography.Text type="secondary" style={{ fontSize: 12 }}>Kalem yok</Typography.Text>
                }
              </Col>
              <Col span={8}>
                <Typography.Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8, color: '#52c41a' }}>Paraşüt Fatura</Typography.Text>
                {lineItems?.invoice_items?.length > 0
                  ? lineItems.invoice_items.map((item, i) => (
                      <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}>
                        <div style={{ fontWeight: 500, marginBottom: 2 }}>{item.product_name || '-'}</div>
                        {item.product_code && <div style={{ color: '#888', fontSize: 11 }}>{item.product_code}</div>}
                        <div style={{ color: '#555' }}>
                          {item.quantity} adet{item.unit_price ? ` · ${Number(item.unit_price).toLocaleString('tr-TR')} ${item.currency || ''}` : ''}
                        </div>
                      </div>
                    ))
                  : <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {shipment?.invoice_url ? (lineItemsLoading ? '…' : 'Fatura kalemi yüklenemedi') : 'Fatura kaydı yok'}
                    </Typography.Text>
                }
              </Col>
              <Col span={8}>
                <Typography.Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8, color: '#fa8c16' }}>İrsaliye</Typography.Text>
                {lineItems?.irsaliye_items?.length > 0
                  ? lineItems.irsaliye_items.map((item, i) => (
                      <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}>
                        <div style={{ fontWeight: 500, marginBottom: 2 }}>{item.product_name || '-'}</div>
                        {item.product_code && <div style={{ color: '#888', fontSize: 11 }}>{item.product_code}</div>}
                        <div style={{ color: '#555' }}>{item.quantity} adet</div>
                      </div>
                    ))
                  : <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {shipment?.irsaliye_id ? (lineItemsLoading ? '…' : 'İrsaliye kalemi yüklenemedi') : 'İrsaliye henüz oluşturulmadı'}
                    </Typography.Text>
                }
              </Col>
            </Row>
          </Card>

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

      {/* Parçalı Sipariş Drawer */}
      <Drawer
        title={`Parçalı Sipariş — ${order?.Displayname || ''}`}
        open={splitOpen}
        onClose={() => setSplitOpen(false)}
        width={820}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setSplitOpen(false)}>İptal</Button>
            <Button type="primary" icon={<BranchesOutlined />} loading={splitting} onClick={handleSplit}>
              2 Parçalı Sipariş Oluştur
            </Button>
          </div>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Sipariş ikiye bölünecek"
          description="Stoktan Hemen Sevk edilebilecek kalemler bir sipariş, kalan tedarik beklenen kalemler ayrı bir sipariş olarak yaratılır. Mevcut sipariş 'BÖLÜNDÜ' olarak işaretlenir."
        />

        <Table
          dataSource={splitItems}
          rowKey={(_, i) => i}
          pagination={false}
          size="small"
          columns={[
            {
              title: 'Ürün',
              dataIndex: 'displayname',
              render: (v) => <span style={{ fontWeight: 500 }}>{v}</span>,
            },
            { title: 'Sipariş', dataIndex: 'ordered_qty', width: 90, align: 'right',
              render: (v) => Number(v).toLocaleString('tr-TR') },
            { title: 'Stok', dataIndex: 'stock_local', width: 90, align: 'right',
              render: (v) => (
                <Tag color={v > 0 ? 'green' : 'default'}>{Number(v).toLocaleString('tr-TR')}</Tag>
              ) },
            {
              title: 'Hemen Sevk', dataIndex: 'in_stock', width: 130,
              render: (v, r, idx) => (
                <InputNumber
                  size="small"
                  value={v}
                  min={0}
                  max={r.ordered_qty}
                  step={1}
                  style={{ width: '100%' }}
                  onChange={(val) => updateSplitItem(idx, 'in_stock', val ?? 0)}
                />
              ),
            },
            {
              title: 'Tedarik Bekliyor', key: 'waiting', width: 130, align: 'right',
              render: (_, r) => {
                const waiting = (r.ordered_qty || 0) - (r.in_stock || 0)
                return waiting > 0
                  ? <Tag color="orange">{waiting.toLocaleString('tr-TR')}</Tag>
                  : <Tag color="green">✓ Hepsi sevk</Tag>
              },
            },
          ]}
        />

        {(() => {
          const inStockTotal = splitItems.reduce((s, it) => s + (Number(it.in_stock) || 0), 0)
          const waitingTotal = splitItems.reduce((s, it) => s + ((Number(it.ordered_qty) || 0) - (Number(it.in_stock) || 0)), 0)
          return (
            <div style={{ marginTop: 16, padding: 12, background: '#fafafa', borderRadius: 6 }}>
              <Space split="·">
                <Text strong>Hemen Sevk: <Text style={{ color: '#52c41a' }}>{inStockTotal}</Text> adet</Text>
                <Text strong>Tedarik Bekliyor: <Text style={{ color: '#fa8c16' }}>{waitingTotal}</Text> adet</Text>
              </Space>
            </div>
          )
        })()}
      </Drawer>
    </div>
  )
}
