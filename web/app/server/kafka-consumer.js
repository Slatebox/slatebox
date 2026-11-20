import { Kafka } from 'kafkajs'
import { Meteor } from 'meteor/meteor'
import { CodeRepositories } from '../imports/api/common/models'

const kafka = new Kafka({
  clientId: Meteor.settings.kafka.clientId,
  brokers: Meteor.settings.kafka.brokers,
})

const consumer = kafka.consumer({ groupId: Meteor.settings.kafka.groupId })

const createCodeRepositoryDoc = async (data) =>
  await CodeRepositories.upsertSync(
    { repo_id: data.repo_id, file: data.file },
    { lastUpdated: Date.now(), ...data }
  )

const runConsumer = async () => {
  await consumer.connect()
  await consumer.subscribe({
    topic: Meteor.settings.kafka.topic,
    fromBeginning: true,
  })
  await consumer.run({
    eachMessage: async ({ message }) => {
      console.log('kafka message received', { bytes: message.value?.length ?? 0 })
      const data = JSON.parse(message.value)
      await createCodeRepositoryDoc(data)
    },
  })
}

export default runConsumer
