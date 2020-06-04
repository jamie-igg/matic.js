import Web3 from 'web3'
import Biconomy from '@biconomy/mexa'
import BN from 'bn.js'
import Contract from 'web3/eth/contract'
// import RootChainManagerArtifact from 'matic-pos-portal/artifacts/RootChainManager.json'
import ChildTokenArtifact from 'matic-pos-portal/artifacts/ChildToken.json'

import ContractsBase from '../common/ContractsBase'
import { address } from '../types/Common'
import Web3Client from '../common/Web3Client'

const domainType = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
]

const metaTransactionType = [
  { name: 'nonce', type: 'uint256' },
  { name: 'from', type: 'address' },
  { name: 'functionSignature', type: 'bytes' },
]

export default class NetworkAgnostic extends ContractsBase {
  public biconomy: Biconomy
  public networkAgnostic: Web3

  constructor(web3Client: Web3Client, maticProvider, biconomyAPIKey: string) {
    super(web3Client)
    this.biconomy = new Biconomy(new Web3.providers.HttpProvider(maticProvider), {
      apiKey: biconomyAPIKey,
      debug: true,
    })
    this.biconomy
      .onEvent(this.biconomy.READY, () => {})
      .onEvent(this.biconomy.ERROR, (error, message) => {
        console.error(error, message) // eslint-disable-line
      })

    this.networkAgnostic = new Web3(this.biconomy)
    if (!this.networkAgnostic) {
      throw new Error(`API KEY is not define`)
    }
  }

  async getTokenContract(tokenAddress: address) {
    const contract = new this.networkAgnostic.eth.Contract(ChildTokenArtifact.abi, tokenAddress)
    return contract
  }

  async getContract(contractABI: any, contractAddress: address) {
    const contract = new this.networkAgnostic.eth.Contract(contractABI, contractAddress)
    return contract
  }
  async transfer(tokenAddress: address, recipientAddress: address, amount: BN, user: address | string) {
    const contract = await this.getTokenContract(tokenAddress)
    let functionSignature = await contract.methods.transfer(recipientAddress, this.encode(amount)).encodeABI()
    await this.networkAgnosticTransaction(tokenAddress, contract, functionSignature, user)
  }

  async approve(tokenAddress: address, spender: address, amount: BN, user: address) {
    const contract = await this.getTokenContract(tokenAddress)
    let functionSignature = await contract.methods.approve(spender, this.encode(amount)).encodeABI()
    await this.networkAgnosticTransaction(tokenAddress, contract, functionSignature, user)
  }

  async networkAgnosticTransaction(
    contractAddress: address,
    contract: Contract,
    functionSignature: any | string,
    userAddress: address
  ) {
    const tokenName = await contract.methods.name().call()
    const parentChainId = '3' // chain id of the network tx is signed on
    let domainData = {
      name: tokenName,
      version: '1',
      chainId: parentChainId,
      verifyingContract: contractAddress,
    }
    let nonce = await contract.methods.getNonce(userAddress).call()

    let message = {
      nonce: parseInt(nonce),
      from: userAddress,
      functionSignature: functionSignature,
      network: 'Interact with Matic Network',
    }
    const dataToSign = JSON.stringify({
      types: {
        EIP712Domain: domainType,
        MetaTransaction: metaTransactionType,
      },
      domain: domainData,
      primaryType: 'MetaTransaction',
      message: message,
    })
    const that = this
    return new Promise(async () => {
      await that.web3Client.parentWeb3.eth.currentProvider.send(
        {
          jsonrpc: '2.0',
          id: 999999999999,
          method: 'eth_signTypedData_v4',
          params: [userAddress, dataToSign],
        },
        async (...response) => {
          let { r, s, v } = await that.getSignatureParameters(response[1].result)
          await contract.methods.executeMetaTransaction(userAddress, functionSignature, r, s, v).send({
            from: userAddress,
          })
        }
      )
    })
  }

  async getSignatureParameters(signature: any) {
    if (!this.web3Client.parentWeb3.utils.isHexStrict(signature)) {
      throw new Error('Given value "'.concat(signature, '" is not a valid hex string.'))
    }
    var r = signature.slice(0, 66)
    var s = '0x'.concat(signature.slice(66, 130))
    let _v = '0x'.concat(signature.slice(130, 132))
    let v = this.web3Client.parentWeb3.utils.hexToNumber(_v)
    if (![27, 28].includes(v)) v += 27
    return {
      r: r,
      s: s,
      v: v,
    }
  }
}