import React, { useEffect, useState } from 'react'
import { Card, Descriptions, Tag, Button, Timeline, Typography, Space, Spin, message, Table, Popconfirm, Modal, Input, Upload, Image } from 'antd'
import { ArrowLeftOutlined, CheckOutlined, RollbackOutlined, ExportOutlined, DeleteOutlined, FilePdfOutlined, ShoppingOutlined, UploadOutlined, PaperClipOutlined } from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useAuthStore } from '../store/auth'

const { Title, Text } = Typography
const { TextArea } = Input

const STAGE_COLORS = {
  pending_admin: 'orange', parasut_review: 'blue',
  pending_parasut_approval: 'purple', preparing: 'cyan', shipped: 'green',
}

const STAGE_LABELS = {
  pending_admin: 'Yönetici Onayı Bekleniyor',
  parasut_review: 'Paraşüt Kontrolü Yapılıyor',
  pending_parasut_approval: 'Paraşüt Onayı Bekleniyor',
  preparing: 'Sevk İçin Hazırlanıyor',
  shipped: 'Sevk Edildi',
}

const ADVANCE_LABELS = {
  pending_admin: 'Onayla (Sevk Sorumlusuna Gönder)',
  parasut_review: 'Paraşüt Onayı Talep Et',
  pending_parasut_approval: 'Paraşüt Belgelerini Onayla',
  preparing: 'Sevk Edildi Olarak İşaretle',
}

export default function ShipmentDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [shipment, setShipment] = useState(null)
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [advancing, setAdvancing] = useState(false)
  const [noteModal, setNoteModal] = useState(null) // 'advance' | 'reject' | null
  const [noteText, setNoteText] = useState('')
  const [uploadingPdf, setUploadingPdf] = useState(false)
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
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

  const openNoteModal = (type) => {
    setNoteText('')
    setNoteModal(type)
  }

  const submitWithNote = async () => {
    setAdvancing(true)
    setNoteModal(null)
    try {
      if (noteModal === 'advance') {
        await api.post(`/shipments/${id}/advance`, { note: noteText || undefined })
        message.success('Aşama güncellendi')
      } else {
        await api.post(`/shipments/${id}/reject`, { note: noteText || 'Reddedildi' })
        message.warning('Talep reddedildi')
      }
      load()
    } catch (e) {
      message.error(e.response?.data?.detail || 'Hata oluştu')
    } finally {
      setAdvancing(false)
    }
  }

  const uploadCargoPdf = async ({ file, onSuccess, onError }) => {
    setUploadingPdf(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await api.post(`/shipments/${id}/upload/cargo-pdf`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setShipment(res.data)
      message.success('Kargo fişi yüklendi')
      onSuccess(res.data)
    } catch (e) {
      message.error('Yükleme başarısız')
      onError(e)
    } finally {
      setUploadingPdf(false)
    }
  }

  const uploadCargoPhotos = async ({ file, onSuccess, onError }) => {
    setUploadingPhotos(true)
    try {
      const form = new FormData()
      form.append('files', file)
      const res = await api.post(`/shipments/${id}/upload/cargo-photos`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setShipment(res.data)
      message.success('Fotoğraf yüklendi')
      onSuccess(res.data)
    } catch (e) {
      message.error('Yükleme başarısız')
      onError(e)
    } finally {
      setUploadingPhotos(false)
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

  const STAGE_ALLOWED_ROLES = {
    pending_admin:            ['admin'],
    parasut_review:           ['warehouse'],
    pending_parasut_approval: ['admin'],
    preparing:                ['warehouse'],
  }
  const isPreparingStage = shipment.stage === 'preparing' && user?.role === 'warehouse'
  const canShip = isPreparingStage && !!shipment.cargo_pdf_url
  const canAdvance = ADVANCE_LABELS[shipment.stage] && STAGE_ALLOWED_ROLES[shipment.stage]?.includes(user?.role)
    && (shipment.stage !== 'preparing' || canShip)
  const canReject = user?.role === 'admin' && ['pending_admin', 'pending_parasut_approval'].includes(shipment.stage)
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
                <Tag color={STAGE_COLORS[shipment.stage]}>{STAGE_LABELS[shipment.stage] || shipment.stage_label}</Tag>
              </Space>
            }
          >
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="Müşteri">{shipment.customer_name}</Descriptions.Item>
              <Descriptions.Item label="Teslim Şekli">{shipment.delivery_type || '-'}</Descriptions.Item>

              <Descriptions.Item label="Planlanan Tarih">{shipment.planned_ship_date || '-'}</Descriptions.Item>

              <Descriptions.Item label="Gönderim Belgesi">{shipment.shipping_doc_type || '-'}</Descriptions.Item>
              <Descriptions.Item label="Oluşturan">{shipment.created_by?.name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Sevk Sorumlusu">{shipment.assigned_to?.name || '-'}</Descriptions.Item>

              {isKargo && <>
                <Descriptions.Item label="Kargo Firması">{shipment.cargo_company || '-'}</Descriptions.Item>
                <Descriptions.Item label="Kargo Takip">{shipment.cargo_tracking_no || '-'}</Descriptions.Item>
                <Descriptions.Item label="Alıcı">{shipment.recipient_name || '-'}</Descriptions.Item>
                <Descriptions.Item label="Alıcı Telefonu">{shipment.recipient_phone || '-'}</Descriptions.Item>
                <Descriptions.Item label="Teslimat Adresi" span={2}>
                  {[shipment.delivery_address, shipment.delivery_district, shipment.delivery_city, shipment.delivery_zip]
                    .filter(Boolean).join(', ') || '-'}
                </Descriptions.Item>
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

            {/* Sevke hazırlık: kargo fişi + fotoğraf yükleme */}
            {isPreparingStage && (
              <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 8, padding: 16 }}>
                  <Text strong style={{ display: 'block', marginBottom: 12 }}>Sevk Öncesi Belgeler</Text>

                  {/* Kargo Fişi PDF */}
                  <div style={{ marginBottom: 12 }}>
                    <Text style={{ display: 'block', marginBottom: 6 }}>
                      Kargo Fişi (PDF) <Text type="danger">*</Text>
                    </Text>
                    {shipment.cargo_pdf_url ? (
                      <Space>
                        <Tag color="green" icon={<PaperClipOutlined />}>
                          <a href={shipment.cargo_pdf_url} target="_blank" rel="noreferrer">
                            Kargo Fişi Yüklendi
                          </a>
                        </Tag>
                        <Upload customRequest={uploadCargoPdf} showUploadList={false} accept=".pdf">
                          <Button size="small">Değiştir</Button>
                        </Upload>
                      </Space>
                    ) : (
                      <Upload customRequest={uploadCargoPdf} showUploadList={false} accept=".pdf">
                        <Button icon={<UploadOutlined />} loading={uploadingPdf}>PDF Yükle</Button>
                      </Upload>
                    )}
                  </div>

                  {/* Fotoğraflar */}
                  <div>
                    <Text style={{ display: 'block', marginBottom: 6 }}>Sipariş Fotoğrafları</Text>
                    <Space wrap>
                      {(shipment.cargo_photo_urls || []).map((url, i) => (
                        <Image
                          key={i}
                          src={url}
                          width={72}
                          height={72}
                          style={{ objectFit: 'cover', borderRadius: 4 }}
                        />
                      ))}
                      <Upload customRequest={uploadCargoPhotos} showUploadList={false} accept="image/*" multiple>
                        <Button icon={<UploadOutlined />} loading={uploadingPhotos} size="small">Fotoğraf Ekle</Button>
                      </Upload>
                    </Space>
                  </div>
                </div>

                {!canShip && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    ⚠ Sevk edildi olarak işaretlemek için kargo fişini yükleyin.
                  </Text>
                )}
              </div>
            )}

            {(canAdvance || canReject || isPreparingStage) && (
              <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                {canAdvance && (
                  <Button type="primary" icon={<CheckOutlined />} onClick={() => openNoteModal('advance')} loading={advancing}>
                    {ADVANCE_LABELS[shipment.stage]}
                  </Button>
                )}
                {canReject && (
                  <Button danger icon={<RollbackOutlined />} onClick={() => openNoteModal('reject')} loading={advancing}>
                    Reddet
                  </Button>
                )}
              </div>
            )}

            <Modal
              title={noteModal === 'reject' ? 'Reddet — Not Ekle' : `${ADVANCE_LABELS[shipment?.stage] || 'Onayla'} — Not Ekle`}
              open={!!noteModal}
              onOk={submitWithNote}
              onCancel={() => setNoteModal(null)}
              okText={noteModal === 'reject' ? 'Reddet' : 'Onayla'}
              okButtonProps={{ danger: noteModal === 'reject' }}
              cancelText="Vazgeç"
            >
              <TextArea
                rows={3}
                placeholder={(() => {
                  if (noteModal === 'reject') return 'İsteğe bağlı not (sevk sorumlusuna görünür)'
                  const adminStages = ['draft', 'parasut_review']   // advance → admin okur
                  const warehouseStages = ['pending_admin', 'pending_parasut_approval'] // advance → sevk sorumlusu okur
                  if (adminStages.includes(shipment?.stage)) return 'İsteğe bağlı not (yöneticiye görünür)'
                  if (warehouseStages.includes(shipment?.stage)) return 'İsteğe bağlı not (sevk sorumlusuna görünür)'
                  return 'İsteğe bağlı not'
                })()}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                autoFocus
              />
            </Modal>
          </Card>

          {/* Sevk Belgeleri — sadece shipped aşamasında */}
          {shipment.stage === 'shipped' && (shipment.cargo_pdf_url || shipment.cargo_photo_urls?.length > 0 || shipment.history?.some(h => h.stage_to === 'shipped')) && (
            <Card title="Sevk Belgeleri" size="small">
              <Descriptions column={2} size="small">
                {(() => {
                  const shippedEntry = shipment.history?.find(h => h.stage_to === 'shipped')
                  return shippedEntry ? (
                    <Descriptions.Item label="Sevk Tamamlanma Tarihi" span={2}>
                      {shippedEntry.created_at ? new Date(shippedEntry.created_at + (shippedEntry.created_at.endsWith('Z') ? '' : 'Z')).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '-'}
                    </Descriptions.Item>
                  ) : null
                })()}
                {shipment.cargo_pdf_url && (
                  <Descriptions.Item label="Kargo Fişi" span={2}>
                    <Button
                      icon={<FilePdfOutlined />}
                      size="small"
                      href={shipment.cargo_pdf_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#ff4d4f', borderColor: '#ff4d4f' }}
                    >
                      Kargo Fişi (PDF)
                    </Button>
                  </Descriptions.Item>
                )}
              </Descriptions>
              {shipment.cargo_photo_urls?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Text strong style={{ display: 'block', marginBottom: 8 }}>Sevk Fotoğrafları</Text>
                  <Image.PreviewGroup>
                    <Space wrap>
                      {shipment.cargo_photo_urls.map((url, i) => (
                        <Image
                          key={i}
                          src={url}
                          width={80}
                          height={80}
                          style={{ objectFit: 'cover', borderRadius: 4 }}
                        />
                      ))}
                    </Space>
                  </Image.PreviewGroup>
                </div>
              )}
            </Card>
          )}

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
              items={(shipment.history || []).map((h) => {
                const isCreated = h.note?.startsWith('[CREATED]')
                const isRejected = h.note?.startsWith('[RED]')
                const noteText = h.note?.replace('[CREATED]', '').replace('[RED]', '').trim()
                const localTime = h.created_at
                  ? new Date(h.created_at + (h.created_at.endsWith('Z') ? '' : 'Z')).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
                  : ''
                return {
                  color: isCreated ? 'green' : isRejected ? 'red' : 'blue',
                  children: (
                    <div>
                      <Text strong style={{ fontSize: 12 }}>{h.user}</Text>
                      <br />
                      {isCreated
                        ? <Text type="secondary" style={{ fontSize: 11 }}>Sevk talebi oluşturuldu</Text>
                        : <Text type="secondary" style={{ fontSize: 11 }}>{STAGE_LABELS[h.stage_from] || h.stage_from} → {STAGE_LABELS[h.stage_to] || h.stage_to}</Text>
                      }
                      {noteText && <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{noteText}</div>}
                      <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>{localTime}</div>
                    </div>
                  ),
                }
              })}
            />
          </Card>
        </div>
      </div>
    </div>
  )
}
