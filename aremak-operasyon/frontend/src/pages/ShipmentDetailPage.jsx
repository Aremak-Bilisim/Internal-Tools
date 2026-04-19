import React, { useEffect, useState } from 'react'
import { Card, Descriptions, Tag, Button, Timeline, Typography, Space, Spin, message, Table, Popconfirm } from 'antd'
import { ArrowLeftOutlined, CheckOutlined, RollbackOutlined, ExportOutlined, DeleteOutlined, FilePdfOutlined, ShoppingOutlined } from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useAuthStore } from '../store/auth'

const { Title, Text } = Typography

const STAGE_COLORS = {
  draft: 'default', pending_admin: 'orange', preparing: 'blue',
  pending_waybill_approval: 'purple', ready_to_ship: 'cyan', shipped: 'green',
}

const ADVANCE_LABELS = {
  draft: 'Onaya Gönder',
  pending_admin: 'Onayla (Hazırlamaya Gönder)',
  preparing: 'İrsaliye Onayına Gönder',
  pending_waybill_approval: 'Onayla (Sevke Hazır)',
  ready_to_ship: 'Sevk Edildi Olarak İşaretle',
}

export default function ShipmentDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [shipment, setShipment] = useState(null)
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [advancing, setAdvancing] = useState(false)
  const [deletingInvoice, setDeletingInvoice] = useState(false)
  const [invoicePdfLoading, setInvoicePdfLoading] = useState(false)
  const [invoiceDetails, setInvoiceDetails] = useState(null)
  const [irsaliye, setIrsaliye] = useState(null)
  const [irsaliyePdfLoading, setIrsaliyePdfLoading] = useState(false)

  const load = () => {
    setLoading(true)
    api.get(`/shipments/${id}`)
      .then((r) => {
        setShipment(r.data)
        // Fatura detayları
        const invId = r.data.invoice_url?.split('/').pop()
        if (invId) {
          api.get(`/parasut/invoices/${invId}/details`)
            .then((ir) => setInvoiceDetails(ir.data))
            .catch(() => {})
        }
        // Sipariş bilgileri
        if (r.data.tg_order_id) {
          api.get(`/orders/${r.data.tg_order_id}`)
            .then((o) => setOrder(o.data))
            .catch(() => {})
        }
        // İrsaliye bilgileri
        if (r.data.irsaliye_id) {
          api.get(`/parasut/irsaliye/${r.data.irsaliye_id}`)
            .then((ir) => setIrsaliye(ir.data))
            .catch(() => {})
        }
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  const advance = async () => {
    setAdvancing(true)
    try {
      await api.post(`/shipments/${id}/advance`, {})
      message.success('Aşama güncellendi')
      load()
    } catch (e) {
      message.error(e.response?.data?.detail || 'Hata oluştu')
    } finally {
      setAdvancing(false)
    }
  }

  const deleteInvoice = async () => {
    setDeletingInvoice(true)
    try {
      await api.delete(`/shipments/${id}/invoice`)
      message.success('Fatura silindi')
      load()
    } catch (e) {
      message.error(e.response?.data?.detail || 'Fatura silinemedi')
    } finally {
      setDeletingInvoice(false)
    }
  }

  const reject = async () => {
    setAdvancing(true)
    try {
      await api.post(`/shipments/${id}/reject`, { note: 'Reddedildi' })
      message.warning('Talep reddedildi')
      load()
    } catch (e) {
      message.error(e.response?.data?.detail || 'Hata oluştu')
    } finally {
      setAdvancing(false)
    }
  }

  const openInvoicePdf = async () => {
    const invId = shipment?.invoice_url?.split('/').pop()
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

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />
  if (!shipment) return <div>Bulunamadı</div>

  const canAdvance = ADVANCE_LABELS[shipment.stage]
  const canReject = user?.role === 'admin' && ['pending_admin', 'pending_waybill_approval'].includes(shipment.stage)
  const isKargo = shipment.delivery_type === 'Kargo'

  const itemColumns = [
    { title: 'Ürün', dataIndex: 'product_name', key: 'product_name' },
    { title: 'Adet', dataIndex: 'quantity', key: 'quantity', width: 80 },
    { title: 'Raf', dataIndex: 'shelf', key: 'shelf', width: 120 },
  ]

  return (
    <div>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/shipments')} style={{ marginBottom: 16 }}>
        Geri
      </Button>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Ana Bilgiler */}
          <Card
            title={
              <Space>
                <span>Sevk Talebi #{shipment.id}</span>
                <Tag color={STAGE_COLORS[shipment.stage]}>{shipment.stage_label}</Tag>
              </Space>
            }
          >
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="Müşteri">{shipment.customer_name}</Descriptions.Item>
              <Descriptions.Item label="Teslim Şekli">{shipment.delivery_type || '-'}</Descriptions.Item>

              <Descriptions.Item label="Planlanan Tarih">{shipment.planned_ship_date || '-'}</Descriptions.Item>

              <Descriptions.Item label="Gönderim Belgesi">{shipment.shipping_doc_type || '-'}</Descriptions.Item>
              <Descriptions.Item label="Oluşturan">{shipment.created_by?.name || '-'}</Descriptions.Item>

              {isKargo && <>
                <Descriptions.Item label="Kargo Firması">{shipment.cargo_company || '-'}</Descriptions.Item>
                <Descriptions.Item label="Kargo Takip">{shipment.cargo_tracking_no || '-'}</Descriptions.Item>
                <Descriptions.Item label="Teslimat Adresi" span={2}>
                  {[shipment.delivery_address, shipment.delivery_district, shipment.delivery_city, shipment.delivery_zip]
                    .filter(Boolean).join(', ') || '-'}
                </Descriptions.Item>
                <Descriptions.Item label="Alıcı">{shipment.recipient_name || '-'}</Descriptions.Item>
                <Descriptions.Item label="Alıcı Telefonu">{shipment.recipient_phone || '-'}</Descriptions.Item>
              </>}

              {shipment.notes && (
                <Descriptions.Item label="Notlar" span={2}>{shipment.notes}</Descriptions.Item>
              )}
            </Descriptions>

            {shipment.items?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Text strong>Ürünler</Text>
                <Table
                  dataSource={shipment.items}
                  columns={itemColumns}
                  rowKey={(_, i) => i}
                  pagination={false}
                  size="small"
                  style={{ marginTop: 8 }}
                />
              </div>
            )}

            {(canAdvance || canReject) && (
              <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                {canAdvance && (
                  <Button type="primary" icon={<CheckOutlined />} onClick={advance} loading={advancing}>
                    {ADVANCE_LABELS[shipment.stage]}
                  </Button>
                )}
                {canReject && (
                  <Button danger icon={<RollbackOutlined />} onClick={reject} loading={advancing}>
                    Reddet
                  </Button>
                )}
              </div>
            )}
          </Card>

          {/* Sipariş Özeti */}
          {shipment.tg_order_id && (
            <Card
              size="small"
              title="Sipariş (TeamGram)"
              extra={
                <Button
                  size="small"
                  icon={<ShoppingOutlined />}
                  onClick={() => navigate(`/orders/${shipment.tg_order_id}`)}
                >
                  Sipariş Detayı
                </Button>
              }
            >
              <Descriptions column={2} size="small">
                <Descriptions.Item label="Müşteri" span={2}>{shipment.customer_name || '-'}</Descriptions.Item>
                <Descriptions.Item label="Sipariş">{shipment.tg_order_name || '-'}</Descriptions.Item>
                <Descriptions.Item label="Sipariş Tarihi">{order?.OrderDate?.slice(0, 10) || '-'}</Descriptions.Item>
                {order && <>
                  <Descriptions.Item label="Tutar (KDV Dahil)">
                    {order.DiscountedTotal
                      ? `${Number(order.DiscountedTotal).toLocaleString('tr-TR')} ${order.CurrencyName}`
                      : '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="Durum">{order.CustomStageName || '-'}</Descriptions.Item>
                </>}
              </Descriptions>
            </Card>
          )}

          {/* Fatura (Paraşüt) */}
          <Card title="Fatura (Paraşüt)" size="small">
            {shipment.invoice_url || shipment.invoice_no ? (
              <>
                <Descriptions column={2} size="small">
                  {invoiceDetails?.contact_name && (
                    <Descriptions.Item label="Müşteri" span={2}>{invoiceDetails.contact_name}</Descriptions.Item>
                  )}
                  <Descriptions.Item label="Fatura No">
                    {(shipment.invoice_no || invoiceDetails?.invoice_no)
                      ? (shipment.invoice_no || invoiceDetails.invoice_no)
                      : <Tag color="orange">Onay Bekleniyor</Tag>}
                  </Descriptions.Item>
                  {invoiceDetails?.issue_date && (
                    <Descriptions.Item label="Fatura Tarihi">{invoiceDetails.issue_date}</Descriptions.Item>
                  )}
                  {invoiceDetails?.net_total && (
                    <Descriptions.Item label="Tutar (KDV Dahil)">
                      {Number(invoiceDetails.net_total).toLocaleString('tr-TR')} {invoiceDetails.currency}
                    </Descriptions.Item>
                  )}
                  {invoiceDetails?.description && (
                    <Descriptions.Item label="Açıklama">{invoiceDetails.description}</Descriptions.Item>
                  )}
                  {shipment.invoice_note && (
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
                  <Button
                    icon={<ExportOutlined />}
                    size="small"
                    href={shipment.invoice_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Paraşüt'te Görüntüle
                  </Button>
                  <Popconfirm
                    title="Faturayı sil"
                    description="Bu fatura Paraşüt'ten silinecek ve bu kayıttan kaldırılacak. Emin misiniz?"
                    onConfirm={deleteInvoice}
                    okText="Evet, Sil"
                    cancelText="Vazgeç"
                    okButtonProps={{ danger: true }}
                  >
                    <Button danger icon={<DeleteOutlined />} size="small" loading={deletingInvoice}>
                      Faturayı Sil
                    </Button>
                  </Popconfirm>
                </div>
              </>
            ) : (
              <Text type="secondary">Bu sevk talebi için fatura kaydı yok.</Text>
            )}
          </Card>

          {/* İrsaliye (Paraşüt) */}
          {shipment.irsaliye_id && (
            <Card title="İrsaliye (Paraşüt)" size="small">
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

        </div>

        {/* Geçmiş */}
        <div style={{ width: 280 }}>
          <Card title="Geçmiş" size="small">
            <Timeline
              items={(shipment.history || []).map((h) => ({
                color: h.note?.startsWith('[RED]') ? 'red' : 'blue',
                children: (
                  <div>
                    <Text strong style={{ fontSize: 12 }}>{h.user}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 11 }}>{h.stage_from} → {h.stage_to}</Text>
                    {h.note && <div style={{ fontSize: 11, color: '#666' }}>{h.note.replace('[RED] ', '')}</div>}
                    <div style={{ fontSize: 10, color: '#999' }}>{h.created_at?.slice(0, 16)}</div>
                  </div>
                ),
              }))}
            />
          </Card>
        </div>
      </div>
    </div>
  )
}
