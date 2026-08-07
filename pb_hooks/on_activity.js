console.log('HOOK FILE EXECUTED AT LOAD TIME')

onRecordCreate('documents', (e) => {
  console.log('!!!!! DOCUMENT CREATE HOOK FIRED !!!!!')
})