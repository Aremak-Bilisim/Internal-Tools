import React, { useEffect, useState } from 'react'
import { Card, Descriptions, Tag, Button, Timeline, Typography, Space, Spin, message, Table, Modal, Input, Upload, Image, Drawer, Form, Select, InputNumber, DatePicker, Row, Col } from 'antd'
import { ArrowLeftOutlined, CheckOutlined, RollbackOutlined, CloseOutlined, UploadOutlined, EditOutlined, SendOutlined, PaperClipOutlined, FilePdfOutlined } from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import api from '../services/api'
import { useAuthStore } from '../store/auth'

const { Text } = Typography
const { TextArea } = Input

const STAGE_COLORS = {
  pending_admin: 'orange',
  preparing: 'cyan',
  shipped: 'green',
  revizyon_bekleniyor: 'volcano',
  iptal_edildi: 'default',
}

const STAGE_LABELS = {
  pending_admin: 'Yönetici Onayı Bekleniyor',
  preparing: 'Sevk İçin Hazırlanıyor',
  shipped: 'Sevk Edildi',
  revizyon_bekleniyor: 'Revizyon Bekleniyor',
  iptal_edildi: 'İptal Edildi',
}

const ADVANCE_LABELS = {
  pending_admin: 'Onayla (Sevk Sorumlusuna Gönder)',
  preparing: 'Sevk Edildi Olarak İşaretle',
  revizyon_bekleniyor: 'Düzelttim, Tekrar Gönder',
}

const STAGE_ROLES = {
  pending_admin: ['admin'],
  preparing: ['warehouse'],
  revizyon_bekleniyor: ['sales', 'admin'],
}

const CARGO_COMPANIES = ['Yurtiçi Kargo', 'Aras Kargo', 'MNG Kargo', 'PTT Kargo', 'Sürat Kargo', 'DHL', 'UPS']

export default function SampleDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [sample, setSample] = useState(null)
  const [loading, setLoading] = useState(true)
  const [advancing, setAdvancing] = useState(false)
  const [noteModal, setNoteModal] = useState(null)  // 'advance' | 'revize' | 'reject' | null
  const [noteText, setNoteText] = useState('')
  const [trackingNo, setTrackingNo] = useState('')
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
  const [uploadingPdf, setUploadingPdf] = useState(false)
  const [editDrawerOpen, setEditDrawerOpen] = useState(false)
  const [editForm] = Form.useForm()
  const [editSubmitting, setEditSubmitting] = useState(false)
  const editDeliveryType = Form.useWatch('delivery_type', editForm)
  const [irsaliye, setIrsaliye] = useState(null)
  // Manuel irsaliye eşleştirme (admin)
  const [matchOpen, setMatchOpen] = useState(false)
  const [matchList, setMatchList] = useState([])
  const [matchLoading, setMatchLoading] = useState(false)
  const [matchSelected, setMatchSelected] = useState(null)
  const [matchSubmitting, setMatchSubmitting] = useState(false)
  const [tgOrder, setTgOrder] = useState(null)
  const isAdmin = user?.role === 'admin'

  const openMatchModal = async () => {
    setMatchOpen(true)
    setMatchSelected(sample?.irsaliye_id || null)
    setMatchList([])
    if (!sample) return
    setMatchLoading(true)
    try {
      // VKN: TG fırsatından çek (varsa); yoksa sadece müşteri adıyla
      let vkn = ''
      const oppId = sample.tg_opportunity_id
      if (oppId) {
        try {
          const tg = await api.get(`/orders/${oppId}`)
          setTgOrder(tg.data)
          vkn = (tg.data?.RelatedEntity?.TaxNo || '').replace(/\D/g, '')
        } catch {}
      }
      const cName = (sample.customer_name || '').trim()
      const p = new URLSearchParams()
      if (vkn) p.set('vkn', vkn)
      if (cName) p.set('name', cName)
      const r = await api.get(`/parasut/irsaliyes/by-vkn?${p.toString()}`)
      setMatchList(r.data?.irsaliyes || [])
    } catch {
      message.error('İrsaliye listesi alınamadı')
    } finally { setMatchLoading(false) }
  }

  const submitMatch = async () => {
    if (!matchSelected) { message.error('Bir irsaliye seçin'); return }
    setMatchSubmitting(true)
    try {
      await api.post(`/samples/${id}/match-irsaliye`, { irsaliye_id: matchSelected })
      message.success('İrsaliye eşleştirildi')
      setMatchOpen(false)
      load()
    } catch (e) {
      message.error(e?.response?.data?.detail || 'Eşleştirme başarısız')
    } finally { setMatchSubmitting(false) }
  }

  const load = () => {
    setLoading(true)
    api.get(`/samples/${id}`)
      .then((r) => {
        setSample(r.data)
        if (r.data.irsaliye_id) {
          api.get(`/parasut/irsaliye/${r.data.irsaliye_id}`)
            .then((ir) => setIrsaliye(ir.data))
            .catch(() => {})
        }
      })
      .catch(() => message.error('Talep yüklenemedi'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  // Ofis Teslim'de kargo fişi zorunlu değil
  const canShip = sample?.stage === 'preparing' && (sample?.delivery_type === 'Ofis Teslim' || !!sample?.cargo_pdf_url)
  const canAdvance = sample && user && STAGE_ROLES[sample.stage]?.includes(user.role)
    && (sample.stage !== 'preparing' || canShip)
  const canRequestRevision = user?.role === 'admin' && sample?.stage === 'pending_admin'
  const canReject = user?.role === 'admin' && !['shipped', 'iptal_edildi'].includes(sample?.stage)

  const openNoteModal = (type) => {
    setNoteText('')
    setTrackingNo('')
    setNoteModal(type)
  }

  const submitWithNote = async () => {
    setAdvancing(true)
    setNoteModal(null)
    try {
      if (noteModal === 'advance') {
        const payload = { note: noteText || undefined }
        if (sample.stage === 'preparing') payload.cargo_tracking_no = trackingNo || undefined
        const r = await api.post(`/samples/${id}/advance`, payload)
        setSample(r.data)
        if (r.data.warnings?.length) r.data.warnings.forEach((w) => message.warning(w, 8))
        message.success('Aşama güncellendi')
      } else if (noteModal === 'revize') {
        if (!noteText.trim()) { message.warning('Revizyon notu zorunludur'); setNoteModal('revize'); return }
        const r = await api.post(`/samples/${id}/revize`, { note: noteText })
        setSample(r.data)
        message.warning('Revizyon talep edildi')
      } else if (noteModal === 'reject') {
        const r = await api.post(`/samples/${id}/cancel`, { note: noteText || undefined })
        setSample(r.data)
        message.warning('Talep iptal edildi')
      }
    } catch (e) {
      message.error(e?.response?.data?.detail || 'Hata oluştu')
    } finally {
      setAdvancing(false)
    }
  }

  const uploadCargoPdf = async ({ file, onSuccess, onError }) => {
    setUploadingPdf(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await api.post(`/samples/${id}/upload/cargo-pdf`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setSample(r.data)
      message.success('Kargo fişi yüklendi')
      onSuccess(r.data)
    } catch (e) {
      message.error('Yükleme başarısız')
      onError(e)
    } finally {
      setUploadingPdf(false)
    }
  }

  const handlePhotoUpload = async ({ file }) => {
    setUploadingPhotos(true)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const r = await api.post(`/samples/${id}/photo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setSample((prev) => ({ ...prev, cargo_photo_urls: r.data.cargo_photo_urls }))
      message.success('Fotoğraf yüklendi')
    } catch {
      message.error('Fotoğraf yüklenemedi')
    } finally {
      setUploadingPhotos(false)
    }
  }

  const openEdit = () => {
    editForm.setFieldsValue({
      delivery_type: sample.delivery_type,
      cargo_company: sample.cargo_company,
      delivery_address: sample.delivery_address,
      delivery_district: sample.delivery_district,
      delivery_city: sample.delivery_city,
      delivery_zip: sample.delivery_zip,
      recipient_name: sample.recipient_name,
      recipient_phone: sample.recipient_phone,
      planned_ship_date: sample.planned_ship_date ? dayjs(sample.planned_ship_date) : null,
      notes: sample.notes,
      waybill_note: sample.waybill_note,
      items: sample.items || [],
    })
    setEditDrawerOpen(true)
  }

  const handleEditSubmit = async () => {
    try {
      const values = await editForm.validateFields()
      setEditSubmitting(true)
      const payload = {
        ...values,
        planned_ship_date: values.planned_ship_date ? dayjs(values.planned_ship_date).format('YYYY-MM-DD') : null,
      }
      const r = await api.patch(`/samples/${id}`, payload)
      setSample(r.data)
      message.success('Güncellendi')
      setEditDrawerOpen(false)
    } catch (e) {
      if (e?.errorFields) return
      message.error('Güncelleme başarısız')
    } finally {
      setEditSubmitting(false)
    }
  }

  const itemColumns = [
    { title: 'Ürün', dataIndex: 'product_name', key: 'product_name' },
    { title: 'Adet', dataIndex: 'quantity', key: 'quantity', width: 80 },
    { title: 'Raf', dataIndex: 'shelf', key: 'shelf', width: 120, render: (v) => v || '-' },
  ]

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />
  if (!sample) return <div>Talep bulunamadı.</div>

  const shipped = sample.stage === 'shipped'
  const cancelled = sample.stage === 'iptal_edildi'
  const isPreparingStage = sample.stage === 'preparing' && user?.role === 'warehouse'

  return (
    <div>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/samples')} style={{ marginBottom: 16 }}>
        Geri
      </Button>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Ana Bilgiler */}
          <Card
            title={
              <Space>
                <span>Numune Talebi #{sample.id}</span>
                <Tag color={STAGE_COLORS[sample.stage]}>{STAGE_LABELS[sample.stage] || sample.stage}</Tag>
              </Space>
            }
            extra={
              !shipped && !cancelled && (
                <Button size="small" icon={<EditOutlined />} onClick={openEdit}>Düzenle</Button>
              )
            }
          >
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="Müşteri">{sample.customer_name}</Descriptions.Item>
              <Descriptions.Item label="TG Fırsatı">{sample.tg_opportunity_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Sevk Şekli">{sample.delivery_type || '-'}</Descriptions.Item>
              <Descriptions.Item label="Kargo Firması">{sample.cargo_company || '-'}</Descriptions.Item>
              <Descriptions.Item label="Planlanan Tarih">{sample.planned_ship_date || '-'}</Descriptions.Item>
              <Descriptions.Item label="Takip No">{sample.cargo_tracking_no || '-'}</Descriptions.Item>
              <Descriptions.Item label="Alıcı">{sample.recipient_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Alıcı Tel">{sample.recipient_phone || '-'}</Descriptions.Item>
              <Descriptions.Item label="Teslimat Adresi" span={2}>
                {[sample.delivery_address, sample.delivery_district, sample.delivery_city, sample.delivery_zip]
                  .filter(Boolean).join(', ') || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Oluşturan">{sample.created_by?.name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Tarih">{sample.created_at?.slice(0, 10) || '-'}</Descriptions.Item>
              {sample.notes && (
                <Descriptions.Item label="Notlar" span={2}>{sample.notes}</Descriptions.Item>
              )}
              {sample.waybill_note && (
                <Descriptions.Item label="İrsaliye Notu" span={2}>{sample.waybill_note}</Descriptions.Item>
              )}
            </Descriptions>

            {sample.items?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Text strong>Ürünler</Text>
                <Table
                  dataSource={sample.items}
                  columns={itemColumns}
                  rowKey={(_, i) => i}
                  pagination={false}
                  size="small"
                  style={{ marginTop: 8 }}
                />
              </div>
            )}

            {/* Sevke hazırlık: kargo fişi + fotoğraf */}
            {isPreparingStage && (
              <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ background: '#fafafa', border: '1px solid #e8e8e8', borderRadius: 8, padding: 16 }}>
                  <Text strong style={{ display: 'block', marginBottom: 12 }}>Sevk Öncesi Belgeler</Text>

                  {/* Kargo Fişi PDF — Ofis Teslim'de gösterilmez */}
                  {sample.delivery_type !== 'Ofis Teslim' && (
                    <div style={{ marginBottom: 12 }}>
                      <Text style={{ display: 'block', marginBottom: 6 }}>
                        Kargo Fişi (PDF) <Text type="danger">*</Text>
                      </Text>
                      {sample.cargo_pdf_url ? (
                        <Space>
                          <Tag color="green" icon={<PaperClipOutlined />}>
                            <a href={sample.cargo_pdf_url} target="_blank" rel="noreferrer">Kargo Fişi Yüklendi</a>
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
                  )}

                  {/* Fotoğraflar */}
                  <div>
                    <Text style={{ display: 'block', marginBottom: 6 }}>Kargo Fotoğrafları</Text>
                    <Space wrap>
                      {(sample.cargo_photo_urls || []).map((url, i) => (
                        <Image key={i} src={url} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 4 }} />
                      ))}
                      <Upload customRequest={handlePhotoUpload} showUploadList={false} accept="image/*" multiple>
                        <Button icon={<UploadOutlined />} loading={uploadingPhotos} size="small">Fotoğraf Ekle</Button>
                      </Upload>
                    </Space>
                  </div>
                </div>

                {!sample.cargo_pdf_url && sample.delivery_type !== 'Ofis Teslim' && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    ⚠ Sevk edildi olarak işaretlemek için kargo fişini yükleyin.
                  </Text>
                )}
              </div>
            )}

            {/* Revizyon notu banner */}
            {sample.stage === 'revizyon_bekleniyor' && sample.revision_note && (
              <div style={{ marginTop: 16, padding: '10px 16px', background: '#fff2e8', border: '1px solid #ffbb96', borderRadius: 6 }}>
                <Text strong style={{ color: '#d4380d', fontSize: 12 }}>Revizyon Notu</Text>
                <div style={{ marginTop: 4, color: '#333' }}>{sample.revision_note}</div>
              </div>
            )}

            {/* İptal banner */}
            {cancelled && (
              <div style={{ marginTop: 16, padding: '10px 16px', background: '#f5f5f5', border: '1px solid #d9d9d9', borderRadius: 6 }}>
                <Text strong style={{ color: '#595959' }}>Bu numune talebi iptal edilmiştir.</Text>
              </div>
            )}

            {/* Aksiyon butonları */}
            {(canAdvance || canRequestRevision || canReject) && (
              <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {canAdvance && (
                  <Button type="primary" icon={<CheckOutlined />} onClick={() => openNoteModal('advance')} loading={advancing}>
                    {ADVANCE_LABELS[sample.stage]}
                  </Button>
                )}
                {canRequestRevision && (
                  <Button
                    icon={<RollbackOutlined />}
                    onClick={() => openNoteModal('revize')}
                    loading={advancing}
                    style={{ borderColor: '#fa8c16', color: '#fa8c16' }}
                  >
                    Revizyon Talep Et
                  </Button>
                )}
                {canReject && (
                  <Button danger icon={<CloseOutlined />} onClick={() => openNoteModal('reject')} loading={advancing}>
                    İptal Et
                  </Button>
                )}
              </div>
            )}

            <Modal
              title={
                noteModal === 'reject' ? 'İptal Et — Not Ekle'
                : noteModal === 'revize' ? 'Revizyon Talep Et'
                : `${ADVANCE_LABELS[sample?.stage] || 'Onayla'} — Not Ekle`
              }
              open={!!noteModal}
              onOk={submitWithNote}
              onCancel={() => setNoteModal(null)}
              okText={noteModal === 'reject' ? 'İptal Et' : noteModal === 'revize' ? 'Revizyon Talep Et' : 'Onayla'}
              okButtonProps={{
                danger: noteModal === 'reject',
                style: noteModal === 'revize' ? { background: '#fa8c16', borderColor: '#fa8c16' } : undefined,
              }}
              cancelText="Vazgeç"
              confirmLoading={advancing}
            >
              {noteModal === 'advance' && sample?.stage === 'preparing' && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Kargo Takip No</label>
                  <Input
                    placeholder="Takip numarası (opsiyonel)"
                    value={trackingNo}
                    onChange={(e) => setTrackingNo(e.target.value)}
                  />
                </div>
              )}
              <TextArea
                rows={3}
                placeholder={(() => {
                  if (noteModal === 'reject') return 'İsteğe bağlı not (satış personeline görünür)'
                  if (noteModal === 'revize') return 'Revizyon açıklaması (zorunlu) — satış personeline gönderilir'
                  if (sample?.stage === 'pending_admin') return 'İsteğe bağlı not (sevk sorumlusuna görünür)'
                  return 'İsteğe bağlı not'
                })()}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                autoFocus
              />
            </Modal>
          </Card>

          {/* İrsaliye */}
          {(sample.irsaliye_id || isAdmin) && (
            <Card
              title="İrsaliye (Paraşüt)"
              size="small"
              extra={isAdmin && (
                <Button size="small" onClick={openMatchModal}>
                  {sample.irsaliye_id ? 'İrsaliyeyi Değiştir' : 'İrsaliye Eşleştir'}
                </Button>
              )}
            >
              {!sample.irsaliye_id && <Text type="secondary">Bu numune için irsaliye kaydı yok.</Text>}
              {sample.irsaliye_id && (irsaliye ? (
                <Descriptions column={2} size="small">
                  {irsaliye.contact_name && (
                    <Descriptions.Item label="Müşteri" span={2}>{irsaliye.contact_name}</Descriptions.Item>
                  )}
                  <Descriptions.Item label="İrsaliye No">
                    {irsaliye.irsaliye_no
                      ? irsaliye.irsaliye_no
                      : <Tag color="orange">Onay Bekleniyor</Tag>}
                  </Descriptions.Item>
                  {irsaliye.issue_date && (
                    <Descriptions.Item label="Düzenleme Tarihi">{irsaliye.issue_date}</Descriptions.Item>
                  )}
                  {irsaliye.description && (
                    <Descriptions.Item label="Açıklama" span={2}>{irsaliye.description}</Descriptions.Item>
                  )}
                </Descriptions>
              ) : (
                <Spin size="small" />
              ))}
              {irsaliye?.url && (
                <div style={{ marginTop: 12 }}>
                  <Button icon={<SendOutlined />} size="small" href={irsaliye.url} target="_blank" rel="noreferrer">
                    Paraşüt'te Görüntüle
                  </Button>
                </div>
              )}
            </Card>
          )}

          {/* Sevk belgeleri (shipped aşamasında) */}
          {shipped && (sample.cargo_pdf_url || sample.cargo_photo_urls?.length > 0) && (
            <Card title="Sevk Belgeleri" size="small">
              {sample.cargo_pdf_url && (
                <div style={{ marginBottom: 12 }}>
                  <Button
                    icon={<FilePdfOutlined />}
                    size="small"
                    href={sample.cargo_pdf_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#ff4d4f', borderColor: '#ff4d4f' }}
                  >
                    Kargo Fişi (PDF)
                  </Button>
                </div>
              )}
              {sample.cargo_photo_urls?.length > 0 && (
                <>
                  <Text strong style={{ display: 'block', marginBottom: 8 }}>Sevk Fotoğrafları</Text>
                  <Image.PreviewGroup>
                    <Space wrap>
                      {sample.cargo_photo_urls.map((url, i) => (
                        <Image key={i} src={url} width={80} height={80} style={{ objectFit: 'cover', borderRadius: 4 }} />
                      ))}
                    </Space>
                  </Image.PreviewGroup>
                </>
              )}
            </Card>
          )}

        </div>

        {/* Geçmiş */}
        <div style={{ width: 280 }}>
          <Card title="Geçmiş" size="small">
            <Timeline
              items={(sample.history || []).map((h) => {
                const isCreated = h.note?.startsWith('[CREATED]')
                const isRejected = h.note?.startsWith('[IPTAL]')
                const isRevision = h.note?.startsWith('[REVIZYON]')
                const cleanNote = (h.note || '')
                  .replace('[CREATED]', '').replace('[IPTAL]', '').replace('[REVIZYON]', '').trim()
                const localTime = h.created_at
                  ? new Date(h.created_at + (h.created_at.endsWith('Z') ? '' : 'Z'))
                      .toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
                  : ''
                return {
                  color: isCreated ? 'green' : isRejected ? 'red' : isRevision ? 'orange' : 'blue',
                  children: (
                    <div>
                      <Text strong style={{ fontSize: 12 }}>{h.user?.name || h.user || '-'}</Text>
                      <br />
                      {isCreated
                        ? <Text type="secondary" style={{ fontSize: 11 }}>Numune talebi oluşturuldu</Text>
                        : <Text type="secondary" style={{ fontSize: 11 }}>
                            {STAGE_LABELS[h.stage_from] || h.stage_from} → {STAGE_LABELS[h.stage_to] || h.stage_to}
                          </Text>
                      }
                      {cleanNote && <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{cleanNote}</div>}
                      <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>{localTime}</div>
                    </div>
                  ),
                }
              })}
            />
          </Card>
        </div>
      </div>

      {/* Düzenleme Drawer */}
      <Drawer
        title="Talebi Düzenle"
        placement="right"
        width={500}
        open={editDrawerOpen}
        onClose={() => setEditDrawerOpen(false)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setEditDrawerOpen(false)}>İptal</Button>
            <Button type="primary" loading={editSubmitting} onClick={handleEditSubmit}>Kaydet</Button>
          </div>
        }
      >
        {/* Revizyon notu hatırlatıcı */}
        {sample?.revision_note && (
          <div style={{ marginBottom: 20, padding: '10px 16px', background: '#fff2e8', border: '1px solid #ffbb96', borderRadius: 6 }}>
            <Text strong style={{ color: '#d4380d', fontSize: 12 }}>Revizyon Notu</Text>
            <div style={{ marginTop: 4, color: '#333', fontSize: 13 }}>{sample.revision_note}</div>
          </div>
        )}

        <Form form={editForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Sevk Şekli" name="delivery_type">
                <Select options={[{ value: 'Kargo', label: 'Kargo' }, { value: 'Ofis Teslim', label: 'Ofis Teslim' }]} allowClear />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Planlanan Sevk Tarihi" name="planned_ship_date">
                <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
              </Form.Item>
            </Col>
          </Row>

          {editDeliveryType === 'Kargo' && (
            <>
              <Form.Item label="Kargo Firması" name="cargo_company">
                <Select options={CARGO_COMPANIES.map((c) => ({ value: c, label: c }))} allowClear />
              </Form.Item>
              <Form.Item label="Teslimat Adresi" name="delivery_address">
                <Input.TextArea rows={2} placeholder="Cadde, sokak, no, daire..." />
              </Form.Item>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="İlçe" name="delivery_district">
                    <Input placeholder="Kadıköy" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="İl" name="delivery_city">
                    <Input placeholder="İstanbul" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="Posta Kodu" name="delivery_zip">
                <Input placeholder="34710" maxLength={5} style={{ width: 120 }} />
              </Form.Item>
              <Row gutter={12}>
                <Col span={14}>
                  <Form.Item label="Alıcı Adı" name="recipient_name">
                    <Input placeholder="Teslim alacak kişi" />
                  </Form.Item>
                </Col>
                <Col span={10}>
                  <Form.Item label="Alıcı Telefonu" name="recipient_phone">
                    <Input placeholder="05xx..." />
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}

          <Form.Item label="Notlar" name="notes">
            <Input.TextArea rows={2} placeholder="İsteğe bağlı..." />
          </Form.Item>
          <Form.Item label="İrsaliye Notu" name="waybill_note">
            <Input.TextArea rows={2} placeholder="İrsaliyeye eklenecek not..." />
          </Form.Item>

          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>Ürünler</div>
                {fields.map(({ key, name }) => (
                  <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                    <Form.Item name={[name, 'product_name']} style={{ marginBottom: 0 }}>
                      <Input placeholder="Ürün adı" style={{ width: 200 }} />
                    </Form.Item>
                    <Form.Item name={[name, 'quantity']} style={{ marginBottom: 0 }}>
                      <InputNumber placeholder="Adet" min={0.01} style={{ width: 80 }} />
                    </Form.Item>
                    <Form.Item name={[name, 'shelf']} style={{ marginBottom: 0 }}>
                      <Input placeholder="Raf" style={{ width: 70 }} />
                    </Form.Item>
                    <Form.Item name={[name, 'product_id']} hidden><Input /></Form.Item>
                    <Button type="text" danger icon={<CloseOutlined />} onClick={() => remove(name)} />
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add({ product_name: '', quantity: 1, shelf: '', product_id: null })} block>
                  + Ürün Ekle
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Drawer>

      <Modal
        title="İrsaliye Eşleştir"
        open={matchOpen}
        onOk={submitMatch}
        onCancel={() => setMatchOpen(false)}
        okText="Eşleştir"
        cancelText="İptal"
        confirmLoading={matchSubmitting}
        width={680}
        destroyOnClose
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          VKN: <Text code>{(tgOrder?.RelatedEntity?.TaxNo || '-')}</Text> · Müşteri: {sample?.customer_name || '-'}
        </Text>
        {matchLoading ? (
          <Spin />
        ) : matchList.length === 0 ? (
          <Text type="secondary">Bu cariye ait irsaliye bulunamadı.</Text>
        ) : (
          <Select
            style={{ width: '100%' }}
            placeholder="Bir irsaliye seçin..."
            value={matchSelected}
            onChange={setMatchSelected}
            showSearch
            optionFilterProp="label"
            options={matchList.map(it => ({
              value: it.id,
              label: `${it.issue_date || '-'} • ${it.gross_total ? `${it.gross_total} TL` : ''} ${it.description ? `• ${it.description}` : ''}`.trim(),
            }))}
          />
        )}
      </Modal>
    </div>
  )
}
