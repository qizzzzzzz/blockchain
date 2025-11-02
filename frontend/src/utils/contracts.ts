import Addresses from './contract-addresses.json'
import EasyBet from './abis/EasyBet.json'

const Web3 = require('web3');

// @ts-ignore
// 创建 web3 实例，使用 MetaMask 提供的 provider
let web3 = new Web3(window.web3.currentProvider)

// EasyBet 合约地址和 ABI
const easyBetAddress = Addresses.easyBet
const easyBetABI = EasyBet.abi

// 获取 EasyBet 合约实例
const easyBetContract = new web3.eth.Contract(easyBetABI, easyBetAddress)

// 导出 web3 实例和 EasyBet 合约实例
export { web3, easyBetContract }
