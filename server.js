'use strict';

// Application Dependencies
const express = require('express');
const superagent = require('superagent');
const cors = require('cors');
const pg = require('pg');

// Load environment variables from .env file
require('dotenv').config();

// Application Setup
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Database Setup
const client = new pg.Client(process.env.DATABASE_URL);
client.connect();

// API Routes
app.get('/location', (request, response) => {
  searchToLatLong(request.query.data)
    .then(location => response.send(location))
    .catch(error => handleError(error, response));
});

app.get('/weather', getWeather);
app.get('/events', getEvents);


// Make sure the server is listening for requests
app.listen(PORT, () => console.log(`Listening on ${PORT}`));

// Error handler
function handleError(err, res) {
  console.error(err);
  if (res) res.status(500).send('Sorry, something went wrong');
}

// Models
function Location(query, res) {
  this.search_query = query;
  this.formatted_query = res.body.results[0].formatted_address;
  this.latitude = res.body.results[0].geometry.location.lat;
  this.longitude = res.body.results[0].geometry.location.lng;
}

function Weather(day) {
  this.forecast = day.summary;
  this.formatted_date = new Date(day.time * 1000).toString().slice(0, 15);
}

function Event(event) {
  this.link = event.url;
  this.event_name = event.name.text;
  this.event_date = new Date(event.start.local).toString().slice(0, 15);
  this.summary = event.summary;
}

function searchToLatLong(query) {
  let sqlStatement = `SELECT * FROM locations WHERE search_query = $1`;
  let values = [query];

  return client.query(sqlStatement, values)
    .then((data) => {
      if(data.rowCount > 0) {
        return data.rows[0];
      } else {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${process.env.GEOCODE_API_KEY}`;

        return superagent.get(url)
          .then(res => {
            let newLocation = new Location(query, res);
            let insertStatement = `INSERT INTO locations (search_query, formatted_query, latitude, longitude)  VALUES ($1, $2, $3, $4)`;
            let insertValues = [newLocation.latitude, newLocation.longitude, newLocation.formatted_query, newLocation.search_query];

            client.query(insertStatement, insertValues);

            return newLocation;
          })
          .catch(error => handleError(error));
      }
    });
}

function getWeather(request, response) {
  const latitude = request.query.data.latitude;
  const longitude = request.query.data.longitude;
  const search_query = request.query.data.search_query;
  let sqlSelectLatitudeLongitude = `SELECT * FROM locations WHERE latitude = $1 AND longitude = $2 AND search_query = $3`;
  let values = [latitude, longitude, search_query];

  return client.query(sqlSelectLatitudeLongitude, values)
    .then(() => {
      const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${values[0]},${values[1]}`;

      return superagent.get(url)
        .then(result => {
          const weatherSummaries = result.body.daily.data.map(day => {
            let newWeather = new Weather(day);
            let insertStatement = `INSERT INTO weather (forecast, formatted_date, search_query)  VALUES ($1, $2, $3)`;
            let insertValues = [newWeather.forecast, newWeather.formatted_date, search_query];

            client.query(insertStatement, insertValues);

            return newWeather;
          });

          response.send(weatherSummaries);
        })
        .catch(error => handleError(error, response));
    });
}

function getEvents(request, response) {
  const eventLocation = request.query.data.search_query;
  let sqlSelectFormattedQuery = `SELECT * FROM locations WHERE search_query = $1`;
  let values = [eventLocation];

  return client.query(sqlSelectFormattedQuery,values)
    .then(() => {
      const url = `https://www.eventbriteapi.com/v3/events/search?token=${process.env.EVENTBRITE_API_KEY}&location.address=${values[0]}`;

      return superagent.get(url)
        .then(result => {
          const events = result.body.events.map(eventData => {
            let event = new Event(eventData);
            return event;
          });
          response.send(events);
        })
        .catch(error => handleError(error, response));
    });
}
