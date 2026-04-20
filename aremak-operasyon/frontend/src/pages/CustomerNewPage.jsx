import React, { useState, useEffect } from 'react'
import {
  Form, Input, Select, Button, Card, Typography, Checkbox,
  message, Row, Col, InputNumber, Spin
} from 'antd'
import { SaveOutlined, SearchOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
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

export default function CustomerNewPage() {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [gibLoading, setGibLoading] = useState(false)
  const [meta, setMeta] = useState({ industries: [], channels: [], relation_types: [] })
  const [metaLoading, setMetaLoading] = useState(true)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  useEffect(() => {
    api.get('/query/customer/meta')
      .then(r => setMeta(r.data))
      .catch(() => message.warning('Seçenek listeleri yüklenemedi'))
      .finally(() => setMetaLoading(false))
  }, [])

  // URL'den VKN geliyorsa forma yaz ve GİB'i otomatik sorgula
  useEffect(() => {
    const vkn = searchParams.get('vkn')
    if (vkn) {
      form.setFieldsValue({ tax_no: vkn })
      // Meta yüklendikten sonra GİB sorgusunu tetikle
      const tryGib = async () => {
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
      tryGib()
    }
  }, [searchParams])

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
    setLoading(true)
    try {
      // Mevcut kayıt kontrolü
      if (values.tax_no) {
        const check = await api.get(`/query/taxpayer/${values.tax_no.trim()}`)
        const tgExists = check.data?.teamgram?.length > 0
        const parasutExists = !!check.data?.parasut

        if (tgExists) {
          const c = check.data.teamgram[0]
          message.error(`Bu vergi numarası TeamGram'da zaten kayıtlı: "${c.name}"`)
          setLoading(false)
          return
        }
        if (values.also_parasut && parasutExists) {
          message.error(`Bu vergi numarası Paraşüt'te zaten kayıtlı: "${check.data.parasut.name}"`)
          setLoading(false)
          return
        }
      }

      await api.post('/query/customer/create', {
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
      message.success('Müşteri başarıyla oluşturuldu')
      navigate('/customer-query')
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
      <Title level={4} style={{ marginBottom: 24 }}>Yeni Müşteri Oluştur (TeamGram)</Title>

      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        initialValues={{
          basic_relation_types: ['Customer'],
          musteri_tipi: 'Kurumsal',
          indirim_seviyesi: '0',
          default_due_days: 0,
          also_parasut: true,
        }}
      >
        {/* Firma Bilgileri */}
        <Card size="small" title="Firma Bilgileri" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="tax_no" label="Vergi No">
                <Input.Search
                  placeholder="1234567890"
                  enterButton={<><SearchOutlined /> GİB'den Sorgula</>}
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
          <Form.Item name="name" label="Firma Adı" rules={[{ required: true, message: 'Firma adı zorunludur' }]} style={{ marginBottom: 0 }}>
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
          <Form.Item name="basic_relation_types" label="İlişki Tipi" rules={[{ required: true, message: 'Zorunlu' }]}>
            <Select mode="multiple" placeholder="Seçiniz">
              {meta.relation_types.map(rt => (
                <Option key={rt.value} value={rt.value}>{rt.label}</Option>
              ))}
            </Select>
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="channel_id" label="Müşteri Adayı Kaynağı" rules={[{ required: true, message: 'Zorunlu' }]}>
                <Select placeholder="Seçiniz">
                  {meta.channels.map(c => <Option key={c.id} value={c.id}>{c.name}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="industry_ids" label="Sektör" rules={[{ required: true, message: 'Zorunlu' }]}>
                <Select placeholder="Seçiniz" mode="multiple">
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
              <Form.Item name="musteri_tipi" label="Müşteri Tipi" rules={[{ required: true, message: 'Zorunlu' }]}>
                <Select>
                  {MUSTERI_TIPI.map(o => <Option key={o} value={o}>{o}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="indirim_seviyesi" label="İndirim Seviyesi (%)" rules={[{ required: true, message: 'Zorunlu' }]}>
                <Select>
                  {INDIRIM_SEVIYESI.map(o => <Option key={o} value={o}>{o}</Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="kullanici_tipi" label="Kullanıcı Tipi" rules={[{ required: true, message: 'Zorunlu' }]} style={{ marginBottom: 0 }}>
            <Select placeholder="Seçiniz">
              {KULLANICI_TIPI.map(o => <Option key={o} value={o}>{o}</Option>)}
            </Select>
          </Form.Item>
        </Card>

        {/* Paraşüt */}
        <Card size="small" style={{ marginBottom: 24 }}>
          <Form.Item name="also_parasut" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Checkbox>Aynı zamanda Paraşüt'e de ekle</Checkbox>
          </Form.Item>
        </Card>

        <Form.Item>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={loading} size="large">
            Oluştur
          </Button>
        </Form.Item>
      </Form>
    </div>
  )
}
