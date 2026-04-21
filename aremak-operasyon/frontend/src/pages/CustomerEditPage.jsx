import React, { useState, useEffect } from 'react'
import {
  Form, Input, Select, Button, Card, Typography, Checkbox,
  message, Row, Col, InputNumber, Spin, Segmented, List,
} from 'antd'
import { SaveOutlined, SearchOutlined, EditOutlined } from '@ant-design/icons'
import api from '../services/api'

const { Title } = Typography
const { Option } = Select
const { TextArea } = Input

const MUSTERI_TIPI = ['Bireysel', 'Kurumsal']
const INDIRIM_SEVIYESI = ['0', '5', '10']
const KULLANICI_TIPI = [
  'Satıcı', 'Son Kullanıcı', 'Makine Üreticisi',
  'Ürün Geliştirici', 'Entegratör/Proje Geliştirici',
]

function buildAddress(gib) {
  if (!gib?.addressInformation?.length) return ''
  const a = gib.addressInformation[0]
  return [
    a.neighborhood,
    a.street,
    (a.exteriorDoorNumber || a.interiorDoorNo)
      ? `No:${a.exteriorDoorNumber || ''} ${a.interiorDoorNo ? `İç:${a.interiorDoorNo}` : ''}`.trim()
      : null,
  ].filter(Boolean).join(' ')
}

export default function CustomerEditPage() {
  const [form] = Form.useForm()
  const [searchMode, setSearchMode] = useState('vkn')
  const [searchQ, setSearchQ] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [nameResults, setNameResults] = useState([])
  const [selectedTgId, setSelectedTgId] = useState(null)
  const [parasutId, setParasutId] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [gibLoading, setGibLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [meta, setMeta] = useState({ industries: [], channels: [], relation_types: [] })
  const [metaLoading, setMetaLoading] = useState(true)

  useEffect(() => {
    api.get('/query/customer/meta')
      .then(r => setMeta(r.data))
      .catch(() => message.warning('Seçenek listeleri yüklenemedi'))
      .finally(() => setMetaLoading(false))
  }, [])

  const resetState = () => {
    setNameResults([])
    setSelectedTgId(null)
    setParasutId(null)
    form.resetFields()
  }

  const handleSearch = async () => {
    const q = searchQ.trim()
    if (!q) { message.warning('Arama terimi giriniz'); return }
    setSearchLoading(true)
    resetState()
    try {
      if (searchMode === 'vkn') {
        const res = await api.get(`/query/taxpayer/${q}`)
        const tg = res.data?.teamgram
        if (!tg || tg.length === 0) {
          message.warning('Bu VKN için TeamGram kaydı bulunamadı')
          return
        }
        await loadCompanyDetail(tg[0].id)
      } else {
        const res = await api.get('/query/search', { params: { q } })
        const results = res.data?.teamgram || []
        if (results.length === 0) {
          message.warning('Sonuç bulunamadı')
        }
        setNameResults(results)
      }
    } catch {
      message.error('Arama başarısız')
    } finally {
      setSearchLoading(false)
    }
  }

  const loadCompanyDetail = async (tgId) => {
    setDetailLoading(true)
    setNameResults([])
    try {
      const res = await api.get(`/query/customer/${tgId}`)
      const d = res.data
      setSelectedTgId(tgId)
      setParasutId(d.parasut_id || null)
      form.setFieldsValue({
        name: d.name,
        tax_no: d.tax_no,
        tax_office: d.tax_office,
        address: d.address,
        district: d.district,
        city: d.city,
        zip_code: d.zip_code,
        phone: d.phone,
        email: d.email,
        website: d.website,
        basic_relation_types: d.basic_relation_types,
        channel_id: d.channel_id,
        industry_ids: d.industry_ids,
        musteri_tipi: d.musteri_tipi || 'Kurumsal',
        indirim_seviyesi: d.indirim_seviyesi || '0',
        kullanici_tipi: d.kullanici_tipi,
        default_due_days: d.default_due_days ?? 0,
        description: d.description,
        also_parasut: !!d.parasut_id,
      })
    } catch {
      message.error('Firma detayları yüklenemedi')
    } finally {
      setDetailLoading(false)
    }
  }

  const handleGibSorgula = async () => {
    const vkn = form.getFieldValue('tax_no')?.trim()
    if (!vkn) { message.warning('Önce Vergi No giriniz'); return }
    setGibLoading(true)
    try {
      const res = await api.get(`/query/taxpayer/${vkn}`)
      const gib = res.data?.gib
      if (!gib) { message.warning("GİB'de bu VKN için kayıt bulunamadı"); return }
      const a = gib.addressInformation?.[0] || {}
      form.setFieldsValue({
        name: gib.identityTitle || gib.title || '',
        tax_office: gib.taxOfficeName || '',
        address: buildAddress(gib),
        district: a.county || '',
        city: a.city || '',
      })
      message.success('GİB bilgileri forma aktarıldı')
    } catch {
      message.error('GİB sorgusu başarısız')
    } finally {
      setGibLoading(false)
    }
  }

  const onFinish = async (values) => {
    if (!selectedTgId) { message.warning('Lütfen önce bir firma seçin'); return }
    setLoading(true)
    try {
      await api.post('/query/customer/update', {
        tg_id: selectedTgId,
        parasut_id: parasutId,
        name: values.name,
        tax_no: values.tax_no,
        tax_office: values.tax_office,
        address: values.address,
        district: values.district,
        city: values.city,
        zip_code: values.zip_code,
        phone: values.phone,
        email: values.email,
        website: values.website,
        basic_relation_types: values.basic_relation_types,
        channel_id: values.channel_id,
        industry_ids: values.industry_ids,
        musteri_tipi: values.musteri_tipi,
        indirim_seviyesi: values.indirim_seviyesi,
        kullanici_tipi: values.kullanici_tipi,
        default_due_days: values.default_due_days,
        description: values.description,
        also_parasut: values.also_parasut || false,
      })
      message.success('Firma bilgileri güncellendi')
    } catch (e) {
      const detail = e?.response?.data?.detail || 'Bir hata oluştu'
      message.error(detail)
    } finally {
      setLoading(false)
    }
  }

  if (metaLoading) return <Spin style={{ display: 'block', marginTop: 60, textAlign: 'center' }} />

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <Title level={4} style={{ marginBottom: 24 }}>Firma Bilgileri Güncelle</Title>

      {/* Arama bölümü */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Segmented
          options={[
            { label: 'VKN ile Ara', value: 'vkn' },
            { label: 'Ünvan ile Ara', value: 'name' },
          ]}
          value={searchMode}
          onChange={(v) => { setSearchMode(v); setSearchQ(''); resetState() }}
          style={{ marginBottom: 12 }}
        />
        <Input.Search
          placeholder={searchMode === 'vkn' ? 'Vergi kimlik numarası' : 'Firma ünvanı'}
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          onSearch={handleSearch}
          enterButton={<><SearchOutlined /> Ara</>}
          loading={searchLoading}
          size="middle"
        />
      </Card>

      {/* Ünvan arama sonuçları */}
      {nameResults.length > 0 && (
        <Card size="small" title={`${nameResults.length} sonuç bulundu`} style={{ marginBottom: 16 }}>
          <List
            dataSource={nameResults}
            renderItem={item => (
              <List.Item
                actions={[
                  <Button
                    key="edit"
                    type="primary"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => loadCompanyDetail(item.id)}
                  >
                    Düzenle
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={item.name}
                  description={
                    <span style={{ fontSize: 12, color: '#666' }}>
                      {item.tax_no && <span>VKN: {item.tax_no}</span>}
                      {item.city && (
                        <span> · {item.district ? `${item.district} / ` : ''}{item.city}</span>
                      )}
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        </Card>
      )}

      {/* Yükleniyor */}
      {detailLoading && (
        <Spin style={{ display: 'block', textAlign: 'center', margin: '24px 0' }} />
      )}

      {/* Düzenleme formu */}
      {selectedTgId && !detailLoading && (
        <Form form={form} layout="vertical" onFinish={onFinish}>

          {/* Firma Bilgileri */}
          <Card size="small" title="Firma Bilgileri" style={{ marginBottom: 16 }}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="tax_no" label="Vergi No">
                  <Input.Search
                    placeholder="1234567890"
                    enterButton={<><SearchOutlined /> GİB'den Güncelle</>}
                    loading={gibLoading}
                    onSearch={handleGibSorgula}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="tax_office" label="Vergi Dairesi">
                  <Input placeholder="Maltepe VD" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name="name"
              label="Firma Adı"
              rules={[{ required: true, message: 'Firma adı zorunludur' }]}
              style={{ marginBottom: 0 }}
            >
              <Input placeholder="Firma unvanı" />
            </Form.Item>
          </Card>

          {/* Adres */}
          <Card size="small" title="Adres" style={{ marginBottom: 16 }}>
            <Form.Item name="address" label="Adres">
              <Input placeholder="Mahalle, cadde, sokak, no" />
            </Form.Item>
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="district" label="İlçe" style={{ marginBottom: 0 }}>
                  <Input placeholder="İlçe" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="city" label="İl" style={{ marginBottom: 0 }}>
                  <Input placeholder="İl" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="zip_code" label="Posta Kodu" style={{ marginBottom: 0 }}>
                  <Input placeholder="34000" />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          {/* İletişim */}
          <Card size="small" title="İletişim" style={{ marginBottom: 16 }}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="phone" label="Telefon">
                  <Input placeholder="+90 5xx xxx xx xx" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="email" label="E-posta">
                  <Input placeholder="info@firma.com" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="website" label="Web Sitesi" style={{ marginBottom: 0 }}>
              <Input placeholder="https://firma.com" />
            </Form.Item>
          </Card>

          {/* CRM Bilgileri */}
          <Card size="small" title="CRM Bilgileri" style={{ marginBottom: 16 }}>
            <Form.Item
              name="basic_relation_types"
              label="İlişki Tipi"
              rules={[{ required: true, message: 'Zorunlu' }]}
            >
              <Select mode="multiple" placeholder="Seçiniz">
                {meta.relation_types.map(rt => (
                  <Option key={rt.value} value={rt.value}>{rt.label}</Option>
                ))}
              </Select>
            </Form.Item>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="channel_id" label="Müşteri Adayı Kaynağı">
                  <Select placeholder="Seçiniz" allowClear>
                    {meta.channels.map(c => <Option key={c.id} value={c.id}>{c.name}</Option>)}
                  </Select>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="industry_ids" label="Sektör">
                  <Select placeholder="Seçiniz" mode="multiple" allowClear>
                    {meta.industries.map(i => <Option key={i.id} value={i.id}>{i.name}</Option>)}
                  </Select>
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="default_due_days" label="Ödeme Vadesi (Gün)">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="description" label="Detaylar" style={{ marginBottom: 0 }}>
              <TextArea rows={3} placeholder="Notlar, açıklama..." />
            </Form.Item>
          </Card>

          {/* Özel Alanlar */}
          <Card size="small" title="Özel Alanlar" style={{ marginBottom: 16 }}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="musteri_tipi"
                  label="Müşteri Tipi"
                  rules={[{ required: true, message: 'Zorunlu' }]}
                >
                  <Select>
                    {MUSTERI_TIPI.map(o => <Option key={o} value={o}>{o}</Option>)}
                  </Select>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="indirim_seviyesi"
                  label="İndirim Seviyesi (%)"
                  rules={[{ required: true, message: 'Zorunlu' }]}
                >
                  <Select>
                    {INDIRIM_SEVIYESI.map(o => <Option key={o} value={o}>{o}</Option>)}
                  </Select>
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name="kullanici_tipi"
              label="Kullanıcı Tipi"
              rules={[{ required: true, message: 'Zorunlu' }]}
              style={{ marginBottom: 0 }}
            >
              <Select placeholder="Seçiniz">
                {KULLANICI_TIPI.map(o => <Option key={o} value={o}>{o}</Option>)}
              </Select>
            </Form.Item>
          </Card>

          {/* Paraşüt — sadece kayıt varsa göster */}
          {parasutId && (
            <Card size="small" style={{ marginBottom: 24 }}>
              <Form.Item name="also_parasut" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Checkbox>Paraşüt kaydını da güncelle</Checkbox>
              </Form.Item>
            </Card>
          )}

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={loading}
              size="large"
            >
              Güncelle
            </Button>
          </Form.Item>
        </Form>
      )}
    </div>
  )
}
