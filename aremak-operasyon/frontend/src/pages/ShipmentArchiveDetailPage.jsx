import React, { useEffect, useState } from 'react'
import { Card, Descriptions, Tag, Button, Typography, Space, Spin, message, Table, Image, Divider } from 'antd'
import { ArrowLeftOutlined, FilePdfOutlined, FileImageOutlined, FileOutlined } from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../services/api'

const { Title, Text } = Typography

const isImage = (name) => /\.(jpe?g|png|gif|webp|bmp)$/i.test(name || '')
const isPdf = (name) => /\.pdf$/i.test(name || '')

const FILE_CATEGORY_ORDER = [
  'Kargo Fişi', 'Fatura', 'İrsaliye', 'Teslim Tutanağı',
  'Sipariş Onay Formu', 'Teklif Dosyası', 'Dekont',
  'Foto-1: Gönderilen Ürünler', 'Foto-2: Paketleme', 'Foto-3: Etiket',
  'Foto-4: Kargo Çıkışı', 'Foto-5: Teslim', 'Foto-6: Gönderinin Son Hali',
]

export default function ShipmentArchiveDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    api.get(`/shipments/archive/${id}`)
      .then((r) => setData(r.data))
      .catch((e) => message.error(e?.response?.data?.detail || 'Arşiv yüklenemedi'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [id])

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />
  if (!data) return <div>Bulunamadı</div>

  const itemColumns = [
    { title: 'Ürün', dataIndex: 'product_name', key: 'product_name' },
    { title: 'SKU', dataIndex: 'sku', key: 'sku', width: 200, render: (v) => v ? <Text code style={{ fontSize: 11 }}>{v}</Text> : '-' },
    { title: 'Adet', dataIndex: 'quantity', key: 'quantity', width: 80, align: 'right' },
    { title: 'Konum', dataIndex: 'shelf', key: 'shelf', width: 130,
      render: (v) => v ? <Tag color="geekblue">{v}</Tag> : '-' },
  ]

  // Kategoriler — bilinen sırada + diğerleri
  const filesByCat = data.files_by_category || {}
  const knownCats = FILE_CATEGORY_ORDER.filter((c) => filesByCat[c]?.length)
  const otherCats = Object.keys(filesByCat).filter((c) => !FILE_CATEGORY_ORDER.includes(c))
  const orderedCats = [...knownCats, ...otherCats]

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
                <span>Sevk Talebi (Arşiv)</span>
                <Tag color="blue">ARŞİV</Tag>
                {data.durum && <Tag color="green">{data.durum}</Tag>}
              </Space>
            }
          >
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="Alıcı">{data.alici_adi || '-'}</Descriptions.Item>
              <Descriptions.Item label="Alıcı Telefon">{data.alici_telefon || '-'}</Descriptions.Item>
              <Descriptions.Item label="Talep Tarihi">{data.talep_tarihi || '-'}</Descriptions.Item>
              <Descriptions.Item label="Sevk Tarihi">
                {data.sevk_tarihi ? <span style={{ color: '#52c41a' }}>{data.sevk_tarihi}</span> : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Planlanan Sevk">{data.planlanan_sevk_tarihi || '-'}</Descriptions.Item>
              <Descriptions.Item label="Sevk Yönü">{data.sevk_yonu || '-'}</Descriptions.Item>
              <Descriptions.Item label="Teslim Şekli">{data.teslim_sekli || '-'}</Descriptions.Item>
              <Descriptions.Item label="Kargo Firması">{data.kargo_firmalari || '-'}</Descriptions.Item>
              <Descriptions.Item label="Gönderim Belgesi">{data.gonderim_belgesi || '-'}</Descriptions.Item>
              <Descriptions.Item label="İrsaliye Adı">{data.irsaliye_adi || '-'}</Descriptions.Item>
              <Descriptions.Item label="Teslimat Adresi" span={2}>{data.teslimat_adresi || '-'}</Descriptions.Item>
              {(data.arac_plakasi || data.sofor_ad_soyad) && (
                <>
                  <Descriptions.Item label="Araç Plakası">{data.arac_plakasi || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Şoför">{data.sofor_ad_soyad || '-'}</Descriptions.Item>
                </>
              )}
              <Descriptions.Item label="Talep Admini">{data.talep_admini || '-'}</Descriptions.Item>
              <Descriptions.Item label="Sevk Sorumlusu">{data.sevk_sorumlusu || '-'}</Descriptions.Item>
              <Descriptions.Item label="İlgili Satışçı">{data.ilgili_satisci || '-'}</Descriptions.Item>
              <Descriptions.Item label="Knack Kayıt ID" span={1}>
                <Text code style={{ fontSize: 11 }}>{data.knack_record_id}</Text>
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {/* Ödeme */}
          {(data.odeme_durumu || data.odeme_tarihi || data.fatura_para_birimi) && (
            <Card title="Ödeme" size="small">
              <Descriptions column={2} bordered size="small">
                <Descriptions.Item label="Durum">{data.odeme_durumu || '-'}</Descriptions.Item>
                <Descriptions.Item label="Tarih">{data.odeme_tarihi || '-'}</Descriptions.Item>
                <Descriptions.Item label="Para Birimi">{data.fatura_para_birimi || '-'}</Descriptions.Item>
                <Descriptions.Item label="Fatura Kuru">{data.fatura_kuru || '-'}</Descriptions.Item>
              </Descriptions>
            </Card>
          )}

          {/* Notlar */}
          {(data.kontrol_notu || data.sevk_sorumlusu_notu || data.irsaliye_notu || data.fatura_notu || data.kargo_icerigi) && (
            <Card title="Notlar" size="small">
              <Descriptions column={1} bordered size="small">
                {data.kontrol_notu && <Descriptions.Item label="Kontrol Notu">{data.kontrol_notu}</Descriptions.Item>}
                {data.sevk_sorumlusu_notu && <Descriptions.Item label="Sevk Sorumlusu">{data.sevk_sorumlusu_notu}</Descriptions.Item>}
                {data.irsaliye_notu && <Descriptions.Item label="İrsaliye Notu">{data.irsaliye_notu}</Descriptions.Item>}
                {data.fatura_notu && <Descriptions.Item label="Fatura Notu">{data.fatura_notu}</Descriptions.Item>}
                {data.kargo_icerigi && <Descriptions.Item label="Kargo İçeriği">{data.kargo_icerigi}</Descriptions.Item>}
              </Descriptions>
            </Card>
          )}

          {/* Ürünler */}
          {data.items?.length > 0 && (
            <Card title={`Ürünler (${data.items.length})`} size="small">
              <Table
                dataSource={data.items}
                columns={itemColumns}
                rowKey={(_, i) => i}
                pagination={false}
                size="small"
              />
            </Card>
          )}

          {/* Dosyalar */}
          {orderedCats.length > 0 && (
            <Card title="Dosyalar" size="small">
              {orderedCats.map((cat) => {
                const files = filesByCat[cat] || []
                if (!files.length) return null
                const photos = files.filter((f) => isImage(f.dosya_adi))
                const docs = files.filter((f) => !isImage(f.dosya_adi))
                return (
                  <div key={cat} style={{ marginBottom: 16 }}>
                    <Text strong style={{ display: 'block', marginBottom: 8 }}>{cat}</Text>
                    {photos.length > 0 && (
                      <Image.PreviewGroup>
                        <Space wrap>
                          {photos.map((f) => (
                            <Image
                              key={f.id}
                              src={f.url}
                              width={80}
                              height={80}
                              style={{ objectFit: 'cover', borderRadius: 4, border: '1px solid #f0f0f0' }}
                            />
                          ))}
                        </Space>
                      </Image.PreviewGroup>
                    )}
                    {docs.length > 0 && (
                      <Space wrap style={{ marginTop: photos.length ? 8 : 0 }}>
                        {docs.map((f) => (
                          <Button
                            key={f.id}
                            size="small"
                            icon={isPdf(f.dosya_adi) ? <FilePdfOutlined /> : <FileOutlined />}
                            href={f.url}
                            target="_blank"
                            rel="noreferrer"
                            style={isPdf(f.dosya_adi) ? { color: '#ff4d4f', borderColor: '#ff4d4f' } : {}}
                          >
                            {f.dosya_adi}
                          </Button>
                        ))}
                      </Space>
                    )}
                  </div>
                )
              })}
            </Card>
          )}

        </div>
      </div>
    </div>
  )
}
