import React, { useEffect, useState } from 'react'
import { Card, Descriptions, Tag, Button, Timeline, Typography, Space, Spin, message, Table, Popconfirm, Modal, Input, Upload, Image, Drawer, Form, Select, InputNumber, DatePicker } from 'antd'
import { ArrowLeftOutlined, CheckOutlined, CloseOutlined, UploadOutlined, EditOutlined } from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import api from '../services/api'
import { useAuthStore } from '../store/auth'

const { Title, Text } = Typography
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
  const [noteModal, setNoteModal] = useState(null)  // 'advance' | 'revize' | null
  const [noteText, setNoteText] = useState('')
  const [trackingNo, setTrackingNo] = useState('')
  const [revizing, setRevizing] = useState(false)
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
  const [editDrawerOpen, setEditDrawerOpen] = useState(false)
  const [editForm] = Form.useForm()
  const [editSubmitting, setEditSubmitting] = useState(false)
  const editDeliveryType = Form.useWatch('delivery_type', editForm)
  const [irsaliye, setIrsaliye] = useState(null)

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

  const canAdvance = () => {
    if (!sample || !user) return false
    const roles = STAGE_ROLES[sample.stage]
    if (!roles) return false
    return roles.includes(user.role) || user.role === 'admin'
  }

  const canCancel = () => {
    if (!sample || !user) return false
    if (sample.stage === 'shipped' || sample.stage === 'iptal_edildi') return false
    return user.role === 'admin' || user.role === 'sales'
  }

  const handleAdvance = async () => {
    setAdvancing(true)
    try {
      const payload = { note: noteText || null }
      if (sample.stage === 'preparing') {
        payload.cargo_tracking_no = trackingNo || null
      }
      const r = await api.post(`/samples/${id}/advance`, payload)
      setSample(r.data)
      if (r.data.warnings?.length) {
        r.data.warnings.forEach((w) => message.warning(w, 8))
      }
      message.success('Aşama güncellendi')
    } catch (e) {
      message.error(e?.response?.data?.detail || 'Hata oluştu')
    } finally {
      setAdvancing(false)
      setNoteModal(null)
      setNoteText('')
      setTrackingNo('')
    }
  }

  const handleRevize = async () => {
    setRevizing(true)
    try {
      const r = await api.post(`/samples/${id}/revize`, { note: noteText || null })
      setSample(r.data)
      message.success('Revizyon için geri gönderildi')
    } catch (e) {
      message.error(e?.response?.data?.detail || 'Hata oluştu')
    } finally {
      setRevizing(false)
      setNoteModal(null)
      setNoteText('')
    }
  }

  const handleCancel = async () => {
    try {
      const r = await api.post(`/samples/${id}/cancel`)
      setSample(r.data)
      message.success('Talep iptal edildi')
    } catch (e) {
      message.error(e?.response?.data?.detail || 'Hata oluştu')
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
    { title: 'Adet', dataIndex: 'quantity', key: 'quantity' },
    { title: 'Raf', dataIndex: 'shelf', key: 'shelf', render: (v) => v || '-' },
  ]

  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
  if (!sample) return <div>Talep bulunamadı.</div>

  const shipped = sample.stage === 'shipped'
  const cancelled = sample.stage === 'iptal_edildi'

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/samples')}>Geri</Button>
        <Title level={4} style={{ margin: 0 }}>
          Numune Talebi #{sample.id} — <Tag color={STAGE_COLORS[sample.stage]}>{STAGE_LABELS[sample.stage]}</Tag>
        </Title>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* Left column */}
        <div style={{ flex: 2, minWidth: 400 }}>
          <Card
            title="Talep Bilgileri"
            size="small"
            style={{ marginBottom: 16 }}
            extra={
              !shipped && !cancelled && (
                <Button size="small" icon={<EditOutlined />} onClick={openEdit}>Düzenle</Button>
              )
            }
          >
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="Müşteri">{sample.customer_name}</Descriptions.Item>
              <Descriptions.Item label="TG Fırsatı">{sample.tg_opportunity_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Sevk Şekli">{sample.delivery_type || '-'}</Descriptions.Item>
              <Descriptions.Item label="Kargo Firması">{sample.cargo_company || '-'}</Descriptions.Item>
              <Descriptions.Item label="Teslim Adresi" span={2}>{sample.delivery_address || '-'}</Descriptions.Item>
              <Descriptions.Item label="İlçe">{sample.delivery_district || '-'}</Descriptions.Item>
              <Descriptions.Item label="İl">{sample.delivery_city || '-'}</Descriptions.Item>
              <Descriptions.Item label="Alıcı">{sample.recipient_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Alıcı Tel">{sample.recipient_phone || '-'}</Descriptions.Item>
              <Descriptions.Item label="Planlanan Tarih">{sample.planned_ship_date || '-'}</Descriptions.Item>
              <Descriptions.Item label="Takip No">{sample.cargo_tracking_no || '-'}</Descriptions.Item>
              <Descriptions.Item label="Notlar" span={2}>{sample.notes || '-'}</Descriptions.Item>
              <Descriptions.Item label="İrsaliye Notu" span={2}>{sample.waybill_note || '-'}</Descriptions.Item>
              <Descriptions.Item label="Oluşturan">{sample.created_by?.name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Tarih">{sample.created_at?.slice(0, 10)}</Descriptions.Item>
            </Descriptions>
          </Card>

          <Card title="Ürünler" size="small" style={{ marginBottom: 16 }}>
            <Table
              dataSource={sample.items || []}
              columns={itemColumns}
              rowKey={(r, i) => i}
              size="small"
              pagination={false}
            />
          </Card>

          {/* İrsaliye */}
          <Card title="İrsaliye" size="small" style={{ marginBottom: 16 }}>
            {sample.irsaliye_id ? (
              irsaliye ? (
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="İrsaliye No">{irsaliye.irsaliye_no || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Tarih">{irsaliye.issue_date || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Cari">{irsaliye.contact_name || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Paraşüt">
                    <a href={irsaliye.url} target="_blank" rel="noreferrer">Paraşüt'te Aç</a>
                  </Descriptions.Item>
                </Descriptions>
              ) : (
                <Spin size="small" />
              )
            ) : (
              <Text type="secondary">İrsaliye henüz oluşturulmadı.</Text>
            )}
          </Card>

          {/* Photos */}
          {(sample.cargo_photo_urls?.length > 0 || sample.stage === 'preparing') && (
            <Card title="Kargo Fotoğrafları" size="small" style={{ marginBottom: 16 }}>
              <Space wrap>
                {(sample.cargo_photo_urls || []).map((url, i) => (
                  <Image key={i} src={url} width={80} height={80} style={{ objectFit: 'cover', borderRadius: 4 }} />
                ))}
              </Space>
              {sample.stage === 'preparing' && (
                <Upload customRequest={handlePhotoUpload} showUploadList={false} accept="image/*">
                  <Button icon={<UploadOutlined />} loading={uploadingPhotos} style={{ marginTop: 8 }}>Fotoğraf Ekle</Button>
                </Upload>
              )}
            </Card>
          )}
        </div>

        {/* Right column */}
        <div style={{ flex: 1, minWidth: 260 }}>
          {/* Actions */}
          {!shipped && !cancelled && (
            <Card title="Aksiyonlar" size="small" style={{ marginBottom: 16 }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                {canAdvance() && (
                  <Button
                    type="primary"
                    icon={<CheckOutlined />}
                    block
                    onClick={() => setNoteModal('advance')}
                  >
                    {ADVANCE_LABELS[sample.stage]}
                  </Button>
                )}
                {sample.stage === 'pending_admin' && user?.role === 'admin' && (
                  <Button
                    danger
                    block
                    onClick={() => setNoteModal('revize')}
                  >
                    Revizyon İste
                  </Button>
                )}
                {canCancel() && (
                  <Popconfirm title="Bu talebi iptal etmek istediğinize emin misiniz?" onConfirm={handleCancel} okText="Evet" cancelText="Hayır">
                    <Button danger icon={<CloseOutlined />} block>İptal Et</Button>
                  </Popconfirm>
                )}
              </Space>
            </Card>
          )}

          {/* History */}
          <Card title="Geçmiş" size="small">
            {sample.history?.length === 0 && <Text type="secondary">Henüz geçmiş yok.</Text>}
            <Timeline
              items={(sample.history || []).map((h) => ({
                color: h.stage_to === 'shipped' ? 'green' : h.stage_to === 'iptal_edildi' ? 'red' : 'blue',
                children: (
                  <div>
                    <div style={{ fontSize: 12, color: '#666' }}>{h.created_at?.slice(0, 16).replace('T', ' ')}</div>
                    <div style={{ fontSize: 13 }}>
                      {h.stage_from
                        ? <><Tag style={{ fontSize: 11 }}>{STAGE_LABELS[h.stage_from] || h.stage_from}</Tag> → <Tag color={STAGE_COLORS[h.stage_to]} style={{ fontSize: 11 }}>{STAGE_LABELS[h.stage_to] || h.stage_to}</Tag></>
                        : <Tag color={STAGE_COLORS[h.stage_to]} style={{ fontSize: 11 }}>{STAGE_LABELS[h.stage_to] || h.stage_to}</Tag>
                      }
                    </div>
                    {h.note && <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>{h.note}</div>}
                    {h.user && <div style={{ fontSize: 11, color: '#999' }}>{h.user.name}</div>}
                  </div>
                ),
              }))}
            />
          </Card>
        </div>
      </div>

      {/* Advance modal */}
      <Modal
        title={ADVANCE_LABELS[sample.stage]}
        open={noteModal === 'advance'}
        onCancel={() => { setNoteModal(null); setNoteText(''); setTrackingNo('') }}
        onOk={handleAdvance}
        okText="Onayla"
        cancelText="Vazgeç"
        confirmLoading={advancing}
      >
        {sample.stage === 'preparing' && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Kargo Takip No</label>
            <Input
              placeholder="Takip numarası (opsiyonel)"
              value={trackingNo}
              onChange={(e) => setTrackingNo(e.target.value)}
            />
          </div>
        )}
        <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Not (opsiyonel)</label>
        <TextArea rows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Notunuzu buraya yazın..." />
      </Modal>

      {/* Revize modal */}
      <Modal
        title="Revizyon İste"
        open={noteModal === 'revize'}
        onCancel={() => { setNoteModal(null); setNoteText('') }}
        onOk={handleRevize}
        okText="Geri Gönder"
        okButtonProps={{ danger: true }}
        cancelText="Vazgeç"
        confirmLoading={revizing}
      >
        <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Revizyon Notu</label>
        <TextArea rows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Ne düzeltilmeli? (opsiyonel)" />
      </Modal>

      {/* Edit Drawer */}
      <Drawer
        title="Talebi Düzenle"
        open={editDrawerOpen}
        onClose={() => setEditDrawerOpen(false)}
        width={500}
        footer={
          <Space style={{ justifyContent: 'flex-end', display: 'flex' }}>
            <Button onClick={() => setEditDrawerOpen(false)}>İptal</Button>
            <Button type="primary" loading={editSubmitting} onClick={handleEditSubmit}>Kaydet</Button>
          </Space>
        }
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="Sevk Şekli" name="delivery_type">
            <Select options={[{ value: 'Ofis Teslim' }, { value: 'Kargo' }]} allowClear />
          </Form.Item>
          {editDeliveryType === 'Kargo' && (
            <Form.Item label="Kargo Firması" name="cargo_company">
              <Select options={CARGO_COMPANIES.map((c) => ({ value: c }))} allowClear />
            </Form.Item>
          )}
          <Form.Item label="Teslim Adresi" name="delivery_address">
            <Input.TextArea rows={2} />
          </Form.Item>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item label="İlçe" name="delivery_district" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item label="İl" name="delivery_city" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </div>
          <Form.Item label="Alıcı Adı" name="recipient_name">
            <Input />
          </Form.Item>
          <Form.Item label="Alıcı Telefon" name="recipient_phone">
            <Input />
          </Form.Item>
          <Form.Item label="Planlanan Sevk Tarihi" name="planned_ship_date">
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>
          <Form.Item label="Notlar" name="notes">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label="İrsaliye Notu" name="waybill_note">
            <Input.TextArea rows={2} />
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
                <Button type="dashed" onClick={() => add({ product_name: '', quantity: 1, shelf: '', product_id: null })} block>+ Ürün Ekle</Button>
              </>
            )}
          </Form.List>
        </Form>
      </Drawer>
    </div>
  )
}
