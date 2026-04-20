import React, { useState } from 'react'
import { Input, Button, Card, Spin, Empty, Tag, Tooltip, message, Divider, Space, Typography, Popconfirm, Segmented } from 'antd'
import {
  SearchOutlined, CopyOutlined, CheckCircleOutlined, CloseCircleOutlined,
  BankOutlined, ShopOutlined, PlusOutlined, SyncOutlined, LinkOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'

const TG_BASE = 'https://www.teamgram.com/aremak'
const PARASUT_BASE = 'https://uygulama.parasut.com/627949'

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
  const navigate = useNavigate()
  const [mode, setMode] = useState('vkn')

  // VKN mode state
  const [vkn, setVkn] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [actionLoading, setActionLoading] = useState({})

  // Name mode state
  const [nameQ, setNameQ] = useState('')
  const [nameLoading, setNameLoading] = useState(false)
  const [nameResults, setNameResults] = useState(null)

  const handleSearch = async (v = null) => {
    const q = (v ?? vkn).trim()
    if (!q) return
    setLoading(true)
    setResult(null)
    try {
      const r = await api.get(`/query/taxpayer/${q}`)
      setResult(r.data)
    } catch {
      message.error('Sorgulama başarısız')
    } finally {
      setLoading(false)
    }
  }

  const handleNameSearch = async () => {
    const q = nameQ.trim()
    if (!q) return
    setNameLoading(true)
    setNameResults(null)
    try {
      const r = await api.get(`/query/search`, { params: { q } })
      setNameResults(r.data)
    } catch {
      message.error('Sorgulama başarısız')
    } finally {
      setNameLoading(false)
    }
  }

  const doAction = async (key, endpoint, body) => {
    setActionLoading(prev => ({ ...prev, [key]: true }))
    try {
      await api.post(endpoint, body)
      message.success('İşlem başarılı')
      // Kartları yenile
      handleSearch(result?.vkn)
    } catch (e) {
      const detail = e?.response?.data?.detail || 'İşlem başarısız'
      message.error(detail)
    } finally {
      setActionLoading(prev => ({ ...prev, [key]: false }))
    }
  }

  const gib = result?.gib
  const parasut = result?.parasut
  const tgList = result?.teamgram || []

  // Aksiyon butonları
  const ActionBar = ({ actions }) => (
    <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #f5f5f5', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {actions.map(({ key, label, icon, danger, endpoint, body, href, onClick }) => (
        href
          ? <Button
              key={key}
              size="small"
              type="default"
              icon={icon}
              href={href}
              target="_blank"
            >
              {label}
            </Button>
          : onClick
          ? <Button
              key={key}
              size="small"
              type="primary"
              ghost
              icon={icon}
              onClick={onClick}
            >
              {label}
            </Button>
          : <Popconfirm
              key={key}
              title={label}
              description="Bu işlemi onaylıyor musunuz?"
              okText="Evet"
              cancelText="Hayır"
              onConfirm={() => doAction(key, endpoint, body)}
            >
              <Button
                size="small"
                type="primary"
                ghost
                icon={icon}
                loading={!!actionLoading[key]}
              >
                {label}
              </Button>
            </Popconfirm>
      ))}
    </div>
  )

  const parasutActions = gib ? (parasut
    ? [
        {
          key: 'parasut-update',
          label: 'GİB ile Güncelle',
          icon: <SyncOutlined />,
          endpoint: `/query/parasut/${parasut.id}/update`,
          body: { gib },
        },
        {
          key: 'parasut-open',
          label: "Paraşüt'te Aç",
          icon: <LinkOutlined />,
          href: `${PARASUT_BASE}/contacts/${parasut.id}`,
        },
      ]
    : [{
        key: 'parasut-add',
        label: "Paraşüt'e Ekle",
        icon: <PlusOutlined />,
        endpoint: '/query/parasut/add',
        body: { gib },
      }]
  ) : []

  const tgActions = gib ? (tgList.length > 0
    ? tgList.flatMap((c) => [
        {
          key: `tg-update-${c.id}`,
          label: tgList.length > 1 ? `GİB ile Güncelle (${c.name})` : 'GİB ile Güncelle',
          icon: <SyncOutlined />,
          endpoint: `/query/teamgram/${c.id}/update`,
          body: { gib },
        },
        {
          key: `tg-open-${c.id}`,
          label: tgList.length > 1 ? `TeamGram'da Aç (${c.name})` : "TeamGram'da Aç",
          icon: <LinkOutlined />,
          href: `${TG_BASE}/parties/show?id=${c.id}&tab=-1`,
        },
      ])
    : [{
        key: 'tg-add',
        label: "TeamGram'a Ekle",
        icon: <PlusOutlined />,
        onClick: () => navigate(`/customer-new?vkn=${gib.taxIdentificationNumber || vkn}`),
      }]
  ) : []

  const tgNameResults = nameResults?.teamgram || []
  const psNameResults = nameResults?.parasut || []

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <Title level={4} style={{ marginBottom: 24 }}>Firma Sorgula</Title>

      <Segmented
        options={[
          { label: 'Vergi No ile Sorgula', value: 'vkn' },
          { label: 'Ünvan ile Sorgula', value: 'name' },
        ]}
        value={mode}
        onChange={setMode}
        style={{ marginBottom: 20 }}
      />

      {mode === 'vkn' && (
        <>
          <Space.Compact style={{ width: '100%', marginBottom: 32 }}>
            <Input
              placeholder="Vergi Kimlik Numarası (VKN)"
              value={vkn}
              onChange={e => setVkn(e.target.value)}
              onPressEnter={() => handleSearch()}
              size="large"
            />
            <Button type="primary" size="large" icon={<SearchOutlined />} onClick={() => handleSearch()} loading={loading}>
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
                  : <Tag color="orange" icon={<CloseCircleOutlined />}>Kayıt Yok</Tag>
                }
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
                {parasutActions.length > 0 && <ActionBar actions={parasutActions} />}
              </Card>

              {/* TeamGram */}
              <Card
                size="small"
                title={<><ShopOutlined style={{ marginRight: 6 }} />TeamGram Müşteri Kaydı</>}
                extra={tgList.length > 0
                  ? <Tag color="green" icon={<CheckCircleOutlined />}>Kayıtlı</Tag>
                  : <Tag color="orange" icon={<CloseCircleOutlined />}>Kayıt Yok</Tag>
                }
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
                ) : <Empty description="Bu VKN ile TeamGram'da kayıt bulunamadı" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                {tgActions.length > 0 && <ActionBar actions={tgActions} />}
              </Card>

            </div>
          )}
        </>
      )}

      {mode === 'name' && (
        <>
          <Space.Compact style={{ width: '100%', marginBottom: 24 }}>
            <Input
              placeholder="Firma ünvanı ile ara..."
              value={nameQ}
              onChange={e => setNameQ(e.target.value)}
              onPressEnter={handleNameSearch}
              size="large"
            />
            <Button type="primary" size="large" icon={<SearchOutlined />} onClick={handleNameSearch} loading={nameLoading}>
              Ara
            </Button>
          </Space.Compact>

          {nameLoading && <Spin size="large" style={{ display: 'block', textAlign: 'center', marginTop: 40 }} />}

          {nameResults && !nameLoading && (
            tgNameResults.length === 0 && psNameResults.length === 0
              ? <Empty description="Sonuç bulunamadı" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                  {/* TeamGram sonuçları */}
                  <Card
                    size="small"
                    title={<><ShopOutlined style={{ marginRight: 6 }} />TeamGram</>}
                    extra={tgNameResults.length > 0
                      ? <Tag color="green" icon={<CheckCircleOutlined />}>{tgNameResults.length} Sonuç</Tag>
                      : <Tag color="orange" icon={<CloseCircleOutlined />}>Sonuç Yok</Tag>}
                  >
                    {tgNameResults.length > 0 ? tgNameResults.map((c, i) => (
                      <div key={c.id}>
                        {i > 0 && <Divider style={{ margin: '8px 0' }} />}
                        <Field label="Firma Adı" value={c.name} />
                        <Field label="Vergi No" value={c.tax_no} />
                        <Field label="Vergi Dairesi" value={c.tax_office} />
                        <Field label="Adres" value={c.address} />
                        <Field label="İlçe / İl" value={[c.district, c.city].filter(Boolean).join(' / ') || null} />
                        <Field label="Telefon" value={c.phone} />
                        <Field label="E-Posta" value={c.email} />
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f5f5f5' }}>
                          <Button size="small" icon={<LinkOutlined />}
                            href={`${TG_BASE}/parties/show?id=${c.id}&tab=-1`} target="_blank">
                            TeamGram'da Aç
                          </Button>
                        </div>
                      </div>
                    )) : <Empty description="Sonuç bulunamadı" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                  </Card>

                  {/* Paraşüt sonuçları */}
                  <Card
                    size="small"
                    title="Paraşüt"
                    extra={psNameResults.length > 0
                      ? <Tag color="green" icon={<CheckCircleOutlined />}>{psNameResults.length} Sonuç</Tag>
                      : <Tag color="orange" icon={<CloseCircleOutlined />}>Sonuç Yok</Tag>}
                  >
                    {psNameResults.length > 0 ? psNameResults.map((c, i) => (
                      <div key={c.id}>
                        {i > 0 && <Divider style={{ margin: '8px 0' }} />}
                        <Field label="Firma Adı" value={c.name} />
                        <Field label="Vergi No" value={c.tax_number} />
                        <Field label="Vergi Dairesi" value={c.tax_office} />
                        <Field label="Adres" value={c.address} />
                        <Field label="İlçe / İl" value={[c.district, c.city].filter(Boolean).join(' / ') || null} />
                        <Field label="E-Posta" value={c.email} />
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f5f5f5' }}>
                          <Button size="small" icon={<LinkOutlined />}
                            href={`${PARASUT_BASE}/contacts/${c.id}`} target="_blank">
                            Paraşüt'te Aç
                          </Button>
                        </div>
                      </div>
                    )) : <Empty description="Sonuç bulunamadı" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                  </Card>

                </div>
          )}
        </>
      )}
    </div>
  )
}
