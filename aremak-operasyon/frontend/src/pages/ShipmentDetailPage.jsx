import React, { useEffect, useState } from 'react'
import { Card, Descriptions, Tag, Button, Timeline, Typography, Space, Spin, message, Table, Popconfirm, Modal, Input, InputNumber, Upload, Image, Drawer, Form, Select, Row, Col, DatePicker } from 'antd'
import { ArrowLeftOutlined, CheckOutlined, RollbackOutlined, ExportOutlined, DeleteOutlined, FilePdfOutlined, ShoppingOutlined, UploadOutlined, PaperClipOutlined, EditOutlined, SendOutlined } from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import api from '../services/api'
import { useAuthStore } from '../store/auth'

const CARGO_COMPANIES = ['Yurtiçi Kargo', 'Aras Kargo', 'MNG Kargo', 'PTT Kargo', 'Sürat Kargo', 'DHL', 'UPS']

const attachmentUrl = (url) => `/api/orders/proxy/attachment?url=${encodeURIComponent(url)}`

// TeamGram sayı formatını otomatik tespit ederek parse eder.
// Son ayırıcı virgülse → Türk formatı ("26.007,23"), noktaysa → US formatı ("26,007.23")
const parseTgNumber = (val) => {
  if (val == null || val === '') return NaN
  const s = String(val).trim()
  const lastComma = s.lastIndexOf(',')
  const lastPeriod = s.lastIndexOf('.')
  if (lastComma === -1 && lastPeriod === -1) return parseFloat(s)
  if (lastComma > lastPeriod) {
    // Türk formatı: "26.007,23" → nokta=binlik, virgül=ondalık
    return parseFloat(s.replace(/\./g, '').replace(',', '.'))
  } else {
    // US formatı: "26,007.23" → virgül=binlik, nokta=ondalık
    return parseFloat(s.replace(/,/g, ''))
  }
}

const { Title, Text } = Typography
const { TextArea } = Input

const STAGE_COLORS = {
  pending_admin: 'orange', parasut_review: 'blue',
  pending_parasut_approval: 'purple', preparing: 'cyan', shipped: 'green',
  revizyon_bekleniyor: 'volcano', iptal_edildi: 'default',
}

const STAGE_LABELS = {
  pending_admin: 'Yönetici Onayı Bekleniyor',
  parasut_review: 'Paraşüt Kontrolü Yapılıyor',
  pending_parasut_approval: 'Paraşüt Onayı Bekleniyor',
  preparing: 'Sevk İçin Hazırlanıyor',
  shipped: 'Sevk Edildi',
  revizyon_bekleniyor: 'Revizyon Bekleniyor',
  iptal_edildi: 'İptal Edildi',
}

const ADVANCE_LABELS = {
  pending_admin: 'Onayla (Sevk Sorumlusuna Gönder)',
  parasut_review: 'Paraşüt Onayı Talep Et',
  pending_parasut_approval: 'Paraşüt Belgelerini Onayla',
  preparing: 'Sevk Edildi Olarak İşaretle',
  revizyon_bekleniyor: 'Yeniden Gönder',
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
  const [lineItems, setLineItems] = useState(null)
  const [lineItemsLoading, setLineItemsLoading] = useState(false)
  const [editDrawerOpen, setEditDrawerOpen] = useState(false)
  const [editForm] = Form.useForm()
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editOrderLoading, setEditOrderLoading] = useState(false)
  const [editPaymentFile, setEditPaymentFile] = useState(null)
  const [editOdemeDoc, setEditOdemeDoc] = useState(null) // mevcut TG ödeme belgesi
  const editDeliveryType = Form.useWatch('delivery_type', editForm)
  const editDocType = Form.useWatch('shipping_doc_type', editForm)
  const editOdemeDurumu = Form.useWatch('odeme_durumu', editForm)

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
        // Kalem karşılaştırma
        setLineItemsLoading(true)
        api.get(`/shipments/${id}/line-items`)
          .then((li) => setLineItems(li.data))
          .catch(() => {})
          .finally(() => setLineItemsLoading(false))
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  const openNoteModal = (type) => {
    setNoteText('')
    setNoteModal(type)
  }

  const openEditDrawer = async () => {
    if (!shipment) return
    setEditPaymentFile(null)
    setEditOdemeDoc(null)
    editForm.setFieldsValue({
      delivery_type: shipment.delivery_type,
      cargo_company: shipment.cargo_company,
      delivery_address: shipment.delivery_address,
      delivery_district: shipment.delivery_district,
      delivery_city: shipment.delivery_city,
      delivery_zip: shipment.delivery_zip,
      recipient_name: shipment.recipient_name,
      recipient_phone: shipment.recipient_phone,
      planned_ship_date: shipment.planned_ship_date ? dayjs(shipment.planned_ship_date) : null,
      shipping_doc_type: shipment.shipping_doc_type,
      notes: shipment.notes,
      invoice_note: shipment.invoice_note,
      waybill_note: shipment.waybill_note,
      odeme_durumu: undefined,
      beklenen_odeme_tarihi: undefined,
    })
    setEditDrawerOpen(true)

    // TG siparişinden ödeme bilgilerini çek
    if (shipment.tg_order_id) {
      setEditOrderLoading(true)
      try {
        const res = await api.get(`/orders/${shipment.tg_order_id}`)
        const o = res.data
        const cfById = Object.fromEntries((o.CustomFieldDatas || []).map(f => [f.CustomFieldId, f]))

        // 193501: Ödeme Durumu
        const odemeCf = cfById[193501]
        let odemeVal = ''
        try { odemeVal = String(JSON.parse(odemeCf?.Value ?? 'null')?.Id ?? '') } catch { odemeVal = String(odemeCf?.Value ?? '') }
        const odemeLabel = odemeVal === '14858' ? 'Ödendi' : odemeVal === '14859' ? 'Ödenecek' : undefined

        // 193502: Beklenen Ödeme Tarihi
        const beklenenCf = cfById[193502]
        const beklenenRaw = beklenenCf?.UnFormattedDate || beklenenCf?.Value
        const beklenenVal = beklenenRaw ? dayjs(beklenenRaw) : undefined

        // 193472: Ödeme Belgesi
        let odemeBelgesi = null
        try { odemeBelgesi = JSON.parse(cfById[193472]?.Value || 'null') } catch {}
        setEditOdemeDoc(odemeBelgesi)

        // 193526: Ödeme Tutarı (number)
        const odemeTutariParsed = parseTgNumber(cfById[193526]?.Value)
        const odemeTutariVal = !isNaN(odemeTutariParsed) ? odemeTutariParsed : undefined

        // 193527: Ödeme Para Birimi (select: 14860=TRL, 14861=USD, 14862=EUR)
        let odemePbId = undefined
        try { odemePbId = String(JSON.parse(cfById[193527]?.Value ?? 'null')?.Id ?? '') || undefined } catch {}

        editForm.setFieldsValue({
          odeme_durumu: odemeLabel,
          beklenen_odeme_tarihi: beklenenVal,
          odeme_tutari: odemeTutariVal,
          odeme_para_birimi: odemePbId,
        })
      } catch { /* sipariş bilgisi alınamazsa sessizce geç */ }
      finally { setEditOrderLoading(false) }
    }
  }

  const submitEditAndResubmit = async () => {
    try {
      const values = await editForm.validateFields()
      setEditSubmitting(true)
      // 1) Talebi güncelle
      await api.put(`/shipments/${id}`, {
        customer_name: shipment.customer_name,
        tg_order_id: shipment.tg_order_id,
        tg_order_name: shipment.tg_order_name,
        delivery_type: values.delivery_type || null,
        cargo_company: values.cargo_company || null,
        delivery_address: values.delivery_address || null,
        delivery_district: values.delivery_district || null,
        delivery_city: values.delivery_city || null,
        delivery_zip: values.delivery_zip || null,
        recipient_name: values.recipient_name || null,
        recipient_phone: values.recipient_phone || null,
        planned_ship_date: values.planned_ship_date ? values.planned_ship_date.format('YYYY-MM-DD') : null,
        shipping_doc_type: values.shipping_doc_type || null,
        notes: values.notes || null,
        invoice_note: values.invoice_note || null,
        waybill_note: values.waybill_note || null,
        items: shipment.items || [],
      })
      // 2) Ödeme durumu zorunlu kontrolü
      if (!values.odeme_durumu) {
        message.error('Ödeme durumu seçilmesi zorunludur')
        setEditSubmitting(false)
        return
      }
      if (values.odeme_durumu === 'Ödendi' && !editOdemeDoc?.length && !editPaymentFile?.file) {
        message.error('Ödeme belgesi yüklenmesi zorunludur')
        setEditSubmitting(false)
        return
      }

      // 3) TG ödeme custom fields güncelle
      if (shipment.tg_order_id) {
        const cfUpdates = {}
        if (values.odeme_durumu) cfUpdates['193501'] = values.odeme_durumu === 'Ödendi' ? '14858' : '14859'
        if (values.beklenen_odeme_tarihi) cfUpdates['193502'] = values.beklenen_odeme_tarihi.format('YYYY-MM-DD')
        if (values.odeme_tutari != null && values.odeme_tutari !== '') cfUpdates['193526'] = String(values.odeme_tutari)
        if (values.odeme_para_birimi) cfUpdates['193527'] = values.odeme_para_birimi
        if (Object.keys(cfUpdates).length) {
          try { await api.put(`/orders/${shipment.tg_order_id}/custom-fields`, { fields: cfUpdates }) } catch {}
        }
        // Ödeme belgesi yükle
        if (editPaymentFile?.file && values.odeme_durumu === 'Ödendi') {
          const fd = new FormData()
          fd.append('file', editPaymentFile.file)
          try { await api.post(`/orders/${shipment.tg_order_id}/payment-doc`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }) } catch {}
        }
      }

      // 4) Yeniden gönder (revizyon_bekleniyor → pending_admin)
      await api.post(`/shipments/${id}/advance`, { note: 'Revizyon tamamlandı, yeniden gönderildi.' })
      message.success('Talep güncellendi ve yeniden gönderildi')
      setEditDrawerOpen(false)
      load()
    } catch (err) {
      if (err?.errorFields) return
      message.error(err?.response?.data?.detail || 'Güncelleme başarısız')
    } finally {
      setEditSubmitting(false)
    }
  }

  const submitWithNote = async () => {
    setAdvancing(true)
    setNoteModal(null)
    try {
      if (noteModal === 'advance') {
        await api.post(`/shipments/${id}/advance`, { note: noteText || undefined })
        message.success('Aşama güncellendi')
      } else if (noteModal === 'revision') {
        if (!noteText.trim()) { message.warning('Revizyon notu zorunludur'); setNoteModal('revision'); return }
        await api.post(`/shipments/${id}/request-revision`, { note: noteText })
        message.warning('Revizyon talep edildi')
      } else if (noteModal === 'return-to-parasut') {
        await api.post(`/shipments/${id}/return-to-parasut`, { note: noteText || undefined })
        message.warning('Paraşüt kontrolü tekrarlatıldı')
      } else {
        await api.post(`/shipments/${id}/reject`, { note: noteText || 'İptal edildi' })
        message.warning('Talep iptal edildi')
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
    revizyon_bekleniyor:      ['sales', 'admin'],
  }
  const isPreparingStage = shipment.stage === 'preparing' && user?.role === 'warehouse'
  // Ofis Teslim'de kargo fişi zorunlu değil
  const canShip = isPreparingStage && (shipment.delivery_type === 'Ofis Teslim' || !!shipment.cargo_pdf_url)
  const canAdvance = ADVANCE_LABELS[shipment.stage] && STAGE_ALLOWED_ROLES[shipment.stage]?.includes(user?.role)
    && (shipment.stage !== 'preparing' || canShip)
  const canRequestRevision = user?.role === 'admin' && shipment.stage === 'pending_admin'
  const canReturnToParasut = user?.role === 'admin' && shipment.stage === 'pending_parasut_approval'
  const canReject = user?.role === 'admin' && !['shipped', 'iptal_edildi', 'draft'].includes(shipment.stage)
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

                  {/* Kargo Fişi PDF — Ofis Teslim'de opsiyonel */}
                  <div style={{ marginBottom: 12 }}>
                    <Text style={{ display: 'block', marginBottom: 6 }}>
                      Kargo Fişi (PDF) {shipment.delivery_type !== 'Ofis Teslim' && <Text type="danger">*</Text>}
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

            {/* Revizyon notu banner — revizyon_bekleniyor aşamasında göster */}
            {shipment.stage === 'revizyon_bekleniyor' && shipment.revision_note && (
              <div style={{ marginTop: 16, padding: '10px 16px', background: '#fff2e8', border: '1px solid #ffbb96', borderRadius: 6 }}>
                <Text strong style={{ color: '#d4380d', fontSize: 12 }}>Revizyon Notu</Text>
                <div style={{ marginTop: 4, color: '#333' }}>{shipment.revision_note}</div>
              </div>
            )}

            {/* İptal banner */}
            {shipment.stage === 'iptal_edildi' && (
              <div style={{ marginTop: 16, padding: '10px 16px', background: '#f5f5f5', border: '1px solid #d9d9d9', borderRadius: 6 }}>
                <Text strong style={{ color: '#595959' }}>Bu sevk talebi iptal edilmiştir.</Text>
              </div>
            )}

            {(canAdvance || canRequestRevision || canReturnToParasut || canReject || isPreparingStage) && (
              <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {/* revizyon_bekleniyor aşamasında düzenleme formu aç */}
                {shipment.stage === 'revizyon_bekleniyor' && STAGE_ALLOWED_ROLES['revizyon_bekleniyor']?.includes(user?.role) ? (
                  <Button type="primary" icon={<EditOutlined />} onClick={openEditDrawer}>
                    Sevk Talebini Güncelle
                  </Button>
                ) : (
                  canAdvance && (
                    <Button type="primary" icon={<CheckOutlined />} onClick={() => openNoteModal('advance')} loading={advancing}>
                      {ADVANCE_LABELS[shipment.stage]}
                    </Button>
                  )
                )}
                {canRequestRevision && (
                  <Button icon={<RollbackOutlined />} onClick={() => openNoteModal('revision')} loading={advancing}
                    style={{ borderColor: '#fa8c16', color: '#fa8c16' }}>
                    Revizyon Talep Et
                  </Button>
                )}
                {canReturnToParasut && (
                  <Button icon={<RollbackOutlined />} onClick={() => openNoteModal('return-to-parasut')} loading={advancing}
                    style={{ borderColor: '#faad14', color: '#faad14' }}>
                    Paraşüt Kontrolünü Tekrarla
                  </Button>
                )}
                {canReject && (
                  <Button danger icon={<RollbackOutlined />} onClick={() => openNoteModal('reject')} loading={advancing}>
                    İptal Et
                  </Button>
                )}
              </div>
            )}

            <Modal
              title={
                noteModal === 'reject' ? 'İptal Et — Not Ekle'
                : noteModal === 'revision' ? 'Revizyon Talep Et'
                : noteModal === 'return-to-parasut' ? 'Paraşüt Kontrolünü Tekrarla'
                : `${ADVANCE_LABELS[shipment?.stage] || 'Onayla'} — Not Ekle`
              }
              open={!!noteModal}
              onOk={submitWithNote}
              onCancel={() => setNoteModal(null)}
              okText={noteModal === 'reject' ? 'İptal Et' : noteModal === 'revision' ? 'Revizyon Talep Et' : noteModal === 'return-to-parasut' ? 'Tekrarla' : 'Onayla'}
              okButtonProps={{
                danger: noteModal === 'reject',
                style: (noteModal === 'revision' || noteModal === 'return-to-parasut') ? { background: '#fa8c16', borderColor: '#fa8c16' } : undefined
              }}
              cancelText="Vazgeç"
            >
              <TextArea
                rows={3}
                placeholder={(() => {
                  if (noteModal === 'reject') return 'İsteğe bağlı not (satış personeline görünür)'
                  if (noteModal === 'revision') return 'Revizyon açıklaması (zorunlu) — satış personeline gönderilir'
                  if (noteModal === 'return-to-parasut') return 'İsteğe bağlı not — sevk sorumlusuna gönderilir'
                  const adminStages = ['parasut_review']
                  const warehouseStages = ['pending_admin', 'pending_parasut_approval']
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

          {/* Ödeme Bilgileri */}
          {order && (() => {
            const cfById = Object.fromEntries((order.CustomFieldDatas || []).map(f => [String(f.CustomFieldId), f]))
            const odemeValRaw = (() => { try { return String(JSON.parse(cfById['193501']?.Value ?? 'null')?.Id ?? '') } catch { return String(cfById['193501']?.Value ?? '') } })()
            const odemeDurumu = odemeValRaw === '14858' ? 'Ödendi' : odemeValRaw === '14859' ? 'Ödenecek' : null
            const beklenenRaw = cfById['193502']?.UnFormattedDate || cfById['193502']?.Value
            const beklenenTarih = beklenenRaw ? beklenenRaw.slice(0, 10) : null
            let odemeBelgeleri = null
            try { odemeBelgeleri = JSON.parse(cfById['193472']?.Value || 'null') } catch {}
            const odemeTutariParsed = parseTgNumber(cfById['193526']?.Value)
            const odemeTutari = !isNaN(odemeTutariParsed) ? odemeTutariParsed : null
            const odemePbRaw = (() => { try { return JSON.parse(cfById['193527']?.Value ?? 'null')?.Value } catch { return null } })()

            if (!odemeDurumu) return null
            return (
              <Card title="Ödeme" size="small">
                <Descriptions column={2} size="small">
                  <Descriptions.Item label="Ödeme Durumu">
                    <Tag color={odemeDurumu === 'Ödendi' ? 'green' : 'orange'}>{odemeDurumu}</Tag>
                  </Descriptions.Item>
                  {beklenenTarih && (
                    <Descriptions.Item label="Beklenen Ödeme Tarihi">{beklenenTarih}</Descriptions.Item>
                  )}
                  {odemeTutari != null && (
                    <Descriptions.Item label="Ödeme Tutarı">
                      {odemeTutari.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} {odemePbRaw || ''}
                    </Descriptions.Item>
                  )}
                </Descriptions>
                {odemeBelgeleri?.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>Ödeme Belgesi</Text>
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
            )
          })()}

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
          {(shipment.tg_order_id || shipment.invoice_url || shipment.irsaliye_id) && (
            <Card
              title="Kalem Özeti"
              size="small"
              extra={lineItemsLoading ? <Spin size="small" /> : null}
            >
              {lineItems ? (
                <Row gutter={24}>
                  <Col span={8}>
                    <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8, color: '#1677ff' }}>Sipariş (TG)</Text>
                    {lineItems.tg_items.length > 0 ? lineItems.tg_items.map((item, i) => (
                      <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}>
                        <div style={{ fontWeight: 500, marginBottom: 2 }}>{item.product_name || '-'}</div>
                        {item.product_code && <div style={{ color: '#888', fontSize: 11 }}>{item.product_code}</div>}
                        <div style={{ color: '#555' }}>
                          {item.quantity} adet
                          {item.unit_price ? ` · ${Number(item.unit_price).toLocaleString('tr-TR')} ${item.currency || ''}` : ''}
                        </div>
                      </div>
                    )) : <Text type="secondary" style={{ fontSize: 12 }}>Sipariş kalemi yok</Text>}
                  </Col>
                  <Col span={8}>
                    <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8, color: '#52c41a' }}>Paraşüt Fatura</Text>
                    {lineItems.invoice_items.length > 0 ? lineItems.invoice_items.map((item, i) => (
                      <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}>
                        <div style={{ fontWeight: 500, marginBottom: 2 }}>{item.product_name || '-'}</div>
                        {item.product_code && <div style={{ color: '#888', fontSize: 11 }}>{item.product_code}</div>}
                        <div style={{ color: '#555' }}>
                          {item.quantity} adet
                          {item.unit_price ? ` · ${Number(item.unit_price).toLocaleString('tr-TR')} ${item.currency || ''}` : ''}
                        </div>
                      </div>
                    )) : (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {shipment.invoice_url ? 'Fatura kalemi yüklenemedi' : 'Fatura kaydı yok'}
                      </Text>
                    )}
                  </Col>
                  <Col span={8}>
                    <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 8, color: '#fa8c16' }}>İrsaliye</Text>
                    {lineItems.irsaliye_items.length > 0 ? lineItems.irsaliye_items.map((item, i) => (
                      <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}>
                        <div style={{ fontWeight: 500, marginBottom: 2 }}>{item.product_name || '-'}</div>
                        {item.product_code && <div style={{ color: '#888', fontSize: 11 }}>{item.product_code}</div>}
                        <div style={{ color: '#555' }}>{item.quantity} adet</div>
                      </div>
                    )) : (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {shipment.irsaliye_id ? 'İrsaliye kalemi yüklenemedi' : 'İrsaliye henüz oluşturulmadı'}
                      </Text>
                    )}
                  </Col>
                </Row>
              ) : (
                !lineItemsLoading && <Text type="secondary" style={{ fontSize: 12 }}>Kalem bilgisi yüklenemedi.</Text>
              )}
            </Card>
          )}

        </div>

        {/* Geçmiş */}
        <div style={{ width: 280 }}>
          <Card title="Geçmiş" size="small">
            <Timeline
              items={(shipment.history || []).map((h) => {
                const isCreated = h.note?.startsWith('[CREATED]')
                const isRejected = h.note?.startsWith('[RED]') || h.note?.startsWith('[IPTAL]')
                const isRevision = h.note?.startsWith('[REVIZYON]')
                const noteText = h.note?.replace('[CREATED]', '').replace('[RED]', '').replace('[IPTAL]', '').replace('[REVIZYON]', '').trim()
                const localTime = h.created_at
                  ? new Date(h.created_at + (h.created_at.endsWith('Z') ? '' : 'Z')).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
                  : ''
                return {
                  color: isCreated ? 'green' : isRejected ? 'red' : isRevision ? 'orange' : 'blue',
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

      {/* Sevk Talebi Düzenleme Drawer */}
      <Drawer
        title="Sevk Talebini Güncelle"
        placement="right"
        width={500}
        open={editDrawerOpen}
        onClose={() => setEditDrawerOpen(false)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setEditDrawerOpen(false)}>İptal</Button>
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={editSubmitting}
              onClick={submitEditAndResubmit}
            >
              Kaydet ve Yeniden Gönder
            </Button>
          </div>
        }
      >
        {/* Revizyon notu hatırlatıcı */}
        {shipment?.revision_note && (
          <div style={{ marginBottom: 20, padding: '10px 16px', background: '#fff2e8', border: '1px solid #ffbb96', borderRadius: 6 }}>
            <Text strong style={{ color: '#d4380d', fontSize: 12 }}>Revizyon Notu</Text>
            <div style={{ marginTop: 4, color: '#333', fontSize: 13 }}>{shipment.revision_note}</div>
          </div>
        )}

        <Form form={editForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="delivery_type"
                label="Teslim Şekli"
                rules={[{ required: true, message: 'Teslim şekli seçin' }]}
              >
                <Select
                  options={[
                    { value: 'Kargo', label: 'Kargo' },
                    { value: 'Ofis Teslim', label: 'Ofis Teslim' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="planned_ship_date"
                label="Planlanan Sevk Tarihi"
                rules={[{ required: true, message: 'Tarih seçin' }]}
              >
                <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
              </Form.Item>
            </Col>
          </Row>

          {editDeliveryType === 'Kargo' && (
            <>
              <Form.Item
                name="cargo_company"
                label="Kargo Firması"
                rules={[{ required: true, message: 'Kargo firması seçin' }]}
              >
                <Select options={CARGO_COMPANIES.map(c => ({ value: c, label: c }))} />
              </Form.Item>

              <Form.Item
                name="delivery_address"
                label="Teslimat Adresi"
                rules={[{ required: true, message: 'Adres gerekli' }]}
              >
                <Input.TextArea rows={2} placeholder="Cadde, sokak, no, daire..." />
              </Form.Item>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="delivery_district" label="İlçe" rules={[{ required: true, message: 'İlçe gerekli' }]}>
                    <Input placeholder="Kadıköy" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="delivery_city" label="İl" rules={[{ required: true, message: 'İl gerekli' }]}>
                    <Input placeholder="İstanbul" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item
                name="delivery_zip"
                label="Posta Kodu"
                rules={[
                  { required: true, message: 'Posta kodu gerekli' },
                  { pattern: /^\d{5}$/, message: '5 haneli posta kodu girin' },
                ]}
              >
                <Input placeholder="34710" maxLength={5} style={{ width: 120 }} />
              </Form.Item>

              <Row gutter={12}>
                <Col span={14}>
                  <Form.Item name="recipient_name" label="Alıcı Adı" rules={[{ required: true, message: 'Alıcı adı gerekli' }]}>
                    <Input placeholder="Teslim alacak kişi" />
                  </Form.Item>
                </Col>
                <Col span={10}>
                  <Form.Item name="recipient_phone" label="Alıcı Telefonu" rules={[{ required: true, message: 'Telefon gerekli' }]}>
                    <Input placeholder="05xx..." />
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}

          <Form.Item
            name="shipping_doc_type"
            label="Gönderim Belgesi"
            rules={[{ required: true, message: 'Gönderim belgesi seçin' }]}
          >
            <Select
              options={[
                { value: 'Fatura', label: 'Fatura' },
                { value: 'İrsaliye', label: 'İrsaliye' },
                { value: 'Fatura + İrsaliye', label: 'Fatura + İrsaliye' },
              ]}
            />
          </Form.Item>

          {(editDocType === 'Fatura' || editDocType === 'Fatura + İrsaliye') && (
            <Form.Item name="invoice_note" label="Fatura Notu">
              <Input.TextArea rows={2} placeholder="Vergi dairesi, açıklama notu vb." />
            </Form.Item>
          )}

          {(editDocType === 'İrsaliye' || editDocType === 'Fatura + İrsaliye') && (
            <Form.Item name="waybill_note" label="İrsaliye Notu">
              <Input.TextArea rows={2} placeholder="İrsaliyeye eklenecek not..." />
            </Form.Item>
          )}

          {/* Ödeme Bilgileri — sevk talebi oluşturma formuyla aynı sırada */}
          {editOrderLoading ? (
            <Spin size="small" style={{ display: 'block', textAlign: 'center', margin: '12px 0' }} />
          ) : (
            <>
              <Form.Item
                name="odeme_durumu"
                label="Ödeme Durumu"
                tooltip="Lütfen güncel ödeme durumunu girin"
                rules={[{ required: true, message: 'Ödeme durumu gerekli' }]}
              >
                <Select
                  placeholder="Güncel durumu seçin..."
                  options={[
                    { value: 'Ödendi', label: 'Ödendi' },
                    { value: 'Ödenecek', label: 'Ödenecek' },
                  ]}
                />
              </Form.Item>

              {editOdemeDurumu === 'Ödendi' && (
                <>
                  <Form.Item label="Ödeme Belgesi" required>
                    {editOdemeDoc?.length ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {editOdemeDoc.map((b, i) => (
                          <a key={i} href={attachmentUrl(b.Url)} target="_blank" rel="noreferrer">
                            <img
                              src={attachmentUrl(b.Url)}
                              alt={b.FileName}
                              style={{ height: 64, borderRadius: 4, border: '1px solid #d9d9d9', cursor: 'pointer', display: 'block' }}
                              onError={e => { e.target.style.display = 'none' }}
                            />
                            <div style={{ fontSize: 11, color: '#1677ff', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.FileName}</div>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <Upload
                        beforeUpload={(file) => { setEditPaymentFile({ file }); return false }}
                        onRemove={() => setEditPaymentFile(null)}
                        maxCount={1}
                        accept="image/*,.pdf"
                        fileList={editPaymentFile?.file ? [{ uid: '1', name: editPaymentFile.file.name, status: 'done' }] : []}
                      >
                        <Button icon={<UploadOutlined />} size="small">Belge Yükle</Button>
                        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>TeamGram'da belge yok</Text>
                      </Upload>
                    )}
                  </Form.Item>

                  <Row gutter={12}>
                    <Col span={14}>
                      <Form.Item name="odeme_tutari" label="Ödeme Tutarı">
                        <InputNumber style={{ width: '100%' }} placeholder="0.00" min={0} precision={2} />
                      </Form.Item>
                    </Col>
                    <Col span={10}>
                      <Form.Item name="odeme_para_birimi" label="Para Birimi">
                        <Select
                          placeholder="Seçin..."
                          options={[
                            { value: '14860', label: 'TRL' },
                            { value: '14861', label: 'USD' },
                            { value: '14862', label: 'EUR' },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              )}

              {editOdemeDurumu === 'Ödenecek' && (
                <Form.Item
                  name="beklenen_odeme_tarihi"
                  label="Beklenen Ödeme Tarihi"
                  rules={[{ required: true, message: 'Tarih seçin' }]}
                >
                  <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
                </Form.Item>
              )}
            </>
          )}

          <Form.Item name="notes" label="Ek Notlar">
            <Input.TextArea rows={2} placeholder="İsteğe bağlı..." />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}
