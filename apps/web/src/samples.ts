export const sampleBaseline = `openapi: 3.0.3
info:
  title: Campus Events API
  version: 1.4.0
paths:
  /events:
    get:
      operationId: listEvents
      parameters:
        - in: query
          name: category
          required: false
          schema:
            type: string
            enum: [academic, social, sports]
      responses:
        '200':
          description: Events found
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Event'
    post:
      operationId: createEvent
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateEvent'
      responses:
        '201':
          description: Created
  /events/{eventId}:
    get:
      operationId: getEvent
      parameters:
        - in: path
          name: eventId
          required: true
          schema: { type: string }
      responses:
        '200':
          description: Event
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Event'
components:
  schemas:
    CreateEvent:
      type: object
      required: [title, startsAt]
      properties:
        title: { type: string }
        startsAt: { type: string, format: date-time }
        venue: { type: string }
    Event:
      type: object
      required: [id, title, startsAt, status]
      properties:
        id: { type: string }
        title: { type: string }
        startsAt: { type: string, format: date-time }
        status:
          type: string
          enum: [draft, published, cancelled]
        venue: { type: string }
`

export const sampleCandidate = `openapi: 3.1.0
info:
  title: Campus Events API
  version: 2.0.0
paths:
  /events:
    get:
      operationId: searchEvents
      parameters:
        - in: query
          name: category
          required: true
          schema:
            type: string
            enum: [academic, social]
      responses:
        '200':
          description: Events found
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Event'
    post:
      operationId: createEvent
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateEvent'
      responses:
        '202':
          description: Accepted
components:
  schemas:
    CreateEvent:
      type: object
      required: [title, startsAt, organizerId]
      properties:
        title: { type: string, minLength: 3 }
        startsAt: { type: string, format: date-time }
        organizerId: { type: string }
    Event:
      type: object
      required: [id, title, startsAt, status]
      properties:
        id: { type: string }
        title: { type: string }
        startsAt: { type: string, format: date-time }
        status:
          type: string
          enum: [draft, published, postponed, cancelled]
`
