import React, { useState } from 'react'
import { Input, Button, Card, Spin, Empty, Tag, Tooltip, message, Divider, Space, Typography } from 'antd'
import {
  SearchOutlined, CopyOutlined, CheckCircleOutlined, CloseCircleOutlined,
  BankOutlined, ShopOutlined,
} from '@ant-design/icons'
import api from '../services/api'

const { Title } = Typography

const ROW = { display: 'flex', alignItems: 'flex-start', padding: '5px 0', borderBottom: '1px solid #f5f5f5' }
const LABEL = { width: 160, flexShrink: 0, color: '#888', fontSize: 13 }
const VALUE = { flex: 1, fontSize: 13, color: '#222', wordBreak: 'break-word' }

function Field({ label, value }) {
  if (!value) return (
    <div style={ROW}>
      <div style={LABEL}>{label}</div>
      <div style={{ ...VALUE, color: '#ccc' }}>—</div>
    </div>
  )
  return (
    <div style={ROW}>
      <div style={LABEL}>{label}</div>
      <div style={VALUE}>
        {value}
        <Tooltip title="Kopyala">
          <Button
            type="text"
            size="small"
            icon={<CopyOutlined style={{ fontSize: 11 }} />}
            onClick={() => { navigator.clipboard.writeText(value); message.success('Kopyalandı') }}
            style={{ color: '#ccc', marginLeft: 4, padding: '0 3px' }}
          />
        </Tooltip>
      </div>
    </div>
  )
}

function buildAddress(gib) {
  if (!gib?.addressInformation?.length) return null
  const a = gib.addressInformation[0]
  return [
    a.neighborhood && `${a.neighborhood},`,
    a.street,
    (a.exteriorDoorNumber || a.interiorDoorNo)
      && `No:${a.exteriorDoorNumber || ''} ${a.interiorDoorNo ? `İç:${a.interiorDoorNo}` : ''}`.trim(),
  ].filter(Boolean).join(' ') || null
}

export default function CustomerQueryPage() {
  const [vkn, setVkn] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  const handleSearch = async () => {
    const v = vkn.trim()
    if (!v) return
    setLoading(true)
    setResult(null)
    try {
      const r = await api.get(`/query/taxpayer/${v}`)
      setResult(r.data)
    } catch {
      message.error('Sorgulama başarısız')
    } finally {
      setLoading(false)
    }
  }

  const gib = result?.gib
  const parasut = result?.parasut
  const tgList = result?.teamgram || []

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <Title level={4} style={{ marginBottom: 24 }}>Müşteri Sorgula</Title>

      <Space.Compact style={{ width: '100%', marginBottom: 32 }}>
        <Input
          placeholder="Vergi Kimlik Numarası (VKN)"
          value={vkn}
          onChange={e => setVkn(e.target.value)}
          onPressEnter={handleSearch}
          size="large"
        />
        <Button type="primary" size="large" icon={<SearchOutlined />} onClick={handleSearch} loading={loading}>
          Sorgula
        </Button>
      </Space.Compact>

      {loading && <Spin size="large" style={{ display: 'block', textAlign: 'center', marginTop: 40 }} />}

      {result && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* GİB */}
          <Card
            size="small"
            title={<><BankOutlined style={{ marginRight: 6 }} />GİB Vergi Mükellefi Bilgisi</>}
            extra={gib
              ? <Tag color="green" icon={<CheckCircleOutlined />}>Mükellef Bulundu</Tag>
              : <Tag color="red" icon={<CloseCircleOutlined />}>Bulunamadı</Tag>}
          >
            {gib ? (
              <>
                <Field label="Firma Unvanı" value={gib.identityTitle || gib.title} />
                <Field label="Vergi No" value={gib.taxIdentificationNumber} />
                <Field label="Vergi Dairesi" value={gib.taxOfficeName} />
                <Field label="Adres" value={buildAddress(gib)} />
                <Field label="İlçe" value={gib.addressInformation?.[0]?.county} />
                <Field label="İl" value={gib.addressInformation?.[0]?.city} />
                {gib.naceActivityInformations?.[0] && (
                  <Field label="Faaliyet" value={gib.naceActivityInformations[0].activityName} />
                )}
                <Field label="Kuruluş Tarihi" value={
                  gib.dateOfStart
                    ? `${gib.dateOfStart.slice(6,8)}.${gib.dateOfStart.slice(4,6)}.${gib.dateOfStart.slice(0,4)}`
                    : null
                } />
              </>
            ) : <Empty description="Bu VKN için GİB kaydı bulunamadı" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>

          {/* Paraşüt */}
          <Card
            size="small"
            title="Paraşüt Müşteri Kaydı"
            extra={parasut
              ? <Tag color="green" icon={<CheckCircleOutlined />}>Kayıtlı</Tag>
              : <Tag color="orange" icon={<CloseCircleOutlined />}>Kayıt Yok</Tag>}
          >
            {parasut ? (
              <>
                <Field label="Firma Adı" value={parasut.name} />
                <Field label="Vergi No" value={parasut.tax_number} />
                <Field label="Vergi Dairesi" value={parasut.tax_office} />
                <Field label="Adres" value={parasut.address} />
                <Field label="İlçe" value={parasut.district} />
                <Field label="İl" value={parasut.city} />
                <Field label="E-Posta" value={parasut.email || null} />
                <Field label="Hesap Türü" value={parasut.account_type === 'customer' ? 'Müşteri' : parasut.account_type} />
              </>
            ) : <Empty description="Bu VKN ile Paraşüt'te kayıtlı müşteri bulunamadı" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>

          {/* TeamGram */}
          <Card
            size="small"
            title={<><ShopOutlined style={{ marginRight: 6 }} />TeamGram Müşteri Kaydı</>}
            extra={tgList.length > 0
              ? <Tag color="green" icon={<CheckCircleOutlined />}>Kayıtlı ({tgList.length})</Tag>
              : <Tag color="orange" icon={<CloseCircleOutlined />}>Kayıt Yok</Tag>}
          >
            {tgList.length > 0 ? (
              tgList.map((c, i) => (
                <div key={c.id}>
                  {i > 0 && <Divider style={{ margin: '8px 0' }} />}
                  <Field label="Firma Adı" value={c.name} />
                  <Field label="Vergi No" value={c.tax_no} />
                  <Field label="Vergi Dairesi" value={c.tax_office} />
                  <Field label="Adres" value={c.address} />
                  <Field label="İlçe / İl" value={[c.district, c.city].filter(Boolean).join(' / ') || null} />
                  <Field label="Telefon" value={c.phone} />
                  <Field label="E-Posta" value={c.email} />
                </div>
              ))
            ) : <Empty description="Bu firma adıyla TeamGram'da kayıt bulunamadı" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>

        </div>
      )}
    </div>
  )
}
