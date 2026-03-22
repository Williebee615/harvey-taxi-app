const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

let drivers = []
let requests = []

// Distance calculator
function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2-lat1) * Math.PI/180
  const dLng = (lng2-lng1) * Math.PI/180

  const a =
    Math.sin(dLat/2)*Math.sin(dLat/2) +
    Math.cos(lat1*Math.PI/180) *
    Math.cos(lat2*Math.PI/180) *
    Math.sin(dLng/2)*Math.sin(dLng/2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

app.post('/driver/update', (req,res)=>{
  const driver = req.body

  const index = drivers.findIndex(d=>d.id===driver.id)

  if(index >= 0){
    drivers[index] = driver
  } else {
    drivers.push(driver)
  }

  res.json({success:true})
})

app.post('/request', (req,res)=>{
  const request = req.body

  request.id = Date.now()
  request.status = "searching"

  requests.push(request)

  let nearest = null
  let minDistance = Infinity

  drivers.forEach(driver=>{
    if(driver.available){

      // service match
      if(driver.services.includes(request.type)){

        const dist = getDistance(
          request.lat,
          request.lng,
          driver.lat,
          driver.lng
        )

        if(dist < minDistance){
          minDistance = dist
          nearest = driver
        }

      }

    }
  })

  if(nearest){
    request.status = "assigned"
    request.driver = nearest

    nearest.available = false
  }

  res.json(request)
})

app.get('/driver/jobs/:id',(req,res)=>{
  const jobs = requests.filter(
    r=>r.driver && r.driver.id === req.params.id
  )

  res.json(jobs)
})

app.get('/requests',(req,res)=>{
  res.json(requests)
})

app.listen(PORT,()=>{
  console.log("SUPER APP LIVE " + PORT)
})
