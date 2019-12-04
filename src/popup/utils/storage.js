export const getAccounts = async () => {
    let accounts = await browser.storage.sync.get('subaccounts')
    
   return Object.keys(accounts).length ? accounts : { subaccounts: [] }
}
